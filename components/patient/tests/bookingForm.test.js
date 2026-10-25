// The booking page's details checks and request (components/patient/bookingForm.js).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bookingPayload,
  detailsError,
  localPhone,
  needsAgeMonths,
  parseYears,
} from "../bookingForm.js";
import { CURRENT_BOOKING_CONSENT, CURRENT_GUARDIAN_CONSENT } from "../../../src/consentText.js";

// A complete, valid video-call booking for the account holder.
const adultOnline = {
  type: "OPD",
  mode: "online",
  forChild: false,
  childName: "",
  ageYears: "34",
  ageMonths: "",
  sex: "female",
  town: " Berekum ",
  area: " Kato ",
  phone: " 024 123 4567 ",
  consent: true,
  guardianConsent: false,
  doctorUid: undefined,
  slotId: null,
};
const childOnline = {
  ...adultOnline,
  forChild: true,
  childName: " Kofi Mensah ",
  ageYears: "6",
  guardianConsent: true,
};
const hospitalVisit = {
  ...adultOnline,
  mode: "in_person",
  ageYears: "",
  sex: "",
  town: "",
  area: "",
};

test("localPhone shows a Ghana number the familiar way", () => {
  assert.equal(localPhone("+233241234567"), "0241234567");
  assert.equal(localPhone("+447700900123"), "+447700900123");
  assert.equal(localPhone("+23324123456"), "+23324123456"); // one digit short: as stored
  assert.equal(localPhone(undefined), "");
  assert.equal(localPhone(null), "");
});

test("parseYears accepts whole years 0-120 only", () => {
  assert.equal(parseYears("34"), 34);
  assert.equal(parseYears(" 7 "), 7);
  assert.equal(parseYears("0"), 0);
  assert.equal(parseYears("120"), 120);
  assert.equal(parseYears("121"), null);
  assert.equal(parseYears("1000"), null);
  assert.equal(parseYears(""), null);
  assert.equal(parseYears("3.5"), null);
  assert.equal(parseYears("abc"), null);
});

test("months are needed only under 2", () => {
  assert.equal(needsAgeMonths(0), true);
  assert.equal(needsAgeMonths(1), true);
  assert.equal(needsAgeMonths(2), false);
  assert.equal(needsAgeMonths(null), false);
});

test("a complete booking has no problem", () => {
  assert.equal(detailsError(adultOnline), null);
  assert.equal(detailsError(childOnline), null);
  assert.equal(detailsError(hospitalVisit), null);
});

test("each missing detail gives its own message", () => {
  const cases = [
    [{ type: "" }, "Choose a consultation type and a mode to continue."],
    [{ mode: "" }, "Choose a consultation type and a mode to continue."],
    [{ ageYears: "" }, "Enter your age in years to continue."],
    [{ ageYears: "200" }, "Enter your age in years to continue."],
    [
      { ageYears: "17" },
      "You must be 18 or older to book for yourself. If this consultation is for your child, choose \"My child (under 18)\" above.",
    ],
    [{ sex: "" }, "Select your sex to continue."],
    [{ town: "  " }, "Enter your town or city to continue."],
    [{ area: "" }, "Enter your area, or a place near you, to continue."],
    [{ phone: "024 123" }, "Enter a phone number we can call you on."],
    [{ consent: false }, "Please confirm you agree to how we use your information before continuing."],
  ];
  for (const [change, message] of cases) {
    assert.equal(detailsError({ ...adultOnline, ...change }), message, JSON.stringify(change));
  }
});

test("child bookings: name, age, months under 2 and guardian consent", () => {
  assert.equal(
    detailsError({ ...childOnline, childName: " K " }),
    "Enter your child's full name to continue.",
  );
  assert.equal(
    detailsError({ ...childOnline, ageYears: "" }),
    "Enter your child's age in years to continue.",
  );
  assert.equal(
    detailsError({ ...childOnline, ageYears: "1", ageMonths: "" }),
    "For a child under 2, also choose their age in months.",
  );
  assert.equal(detailsError({ ...childOnline, ageYears: "1", ageMonths: "0" }), null);
  assert.equal(
    detailsError({ ...childOnline, ageYears: "18" }),
    "This age is 18 or over. Adults need to book from their own account.",
  );
  assert.equal(
    detailsError({ ...childOnline, guardianConsent: false }),
    "Please confirm you are the child's parent or guardian and give consent for them.",
  );
});

test("a hospital visit asks no age, sex or location, but still a phone and consent", () => {
  assert.equal(detailsError({ ...hospitalVisit, ageYears: "5" }), null); // age not checked
  assert.equal(
    detailsError({ ...hospitalVisit, phone: "" }),
    "Enter a phone number we can call you on.",
  );
  assert.equal(
    detailsError({ ...hospitalVisit, consent: false }),
    "Please confirm you agree to how we use your information before continuing.",
  );
});

test("the first problem wins", () => {
  assert.equal(
    detailsError({ ...adultOnline, sex: "", phone: "", consent: false }),
    "Select your sex to continue.",
  );
});

test("payload for a video call for yourself", () => {
  assert.deepEqual(bookingPayload(adultOnline), {
    type: "OPD",
    mode: "online",
    ageYears: 34,
    sex: "female",
    town: "Berekum",
    area: "Kato",
    phone: "024 123 4567",
    doctorUid: null,
    slotId: null,
    consentVersion: CURRENT_BOOKING_CONSENT,
  });
});

test("payload for a child under 2 with a chosen doctor and slot", () => {
  assert.deepEqual(
    bookingPayload({ ...childOnline, ageYears: "1", ageMonths: "4", doctorUid: "doc1", slotId: "slot1" }),
    {
      type: "OPD",
      mode: "online",
      ageYears: 1,
      ageMonths: 4,
      sex: "female",
      town: "Berekum",
      area: "Kato",
      phone: "024 123 4567",
      doctorUid: "doc1",
      slotId: "slot1",
      consentVersion: CURRENT_BOOKING_CONSENT,
      forChild: true,
      childName: "Kofi Mensah",
      guardianConsentVersion: CURRENT_GUARDIAN_CONSENT,
    },
  );
});

test("payload for a hospital visit leaves out age, sex and location", () => {
  assert.deepEqual(bookingPayload({ ...hospitalVisit, type: "SURGICAL", ageYears: "40", sex: "male" }), {
    type: "SURGICAL",
    mode: "in_person",
    phone: "024 123 4567",
    doctorUid: null,
    slotId: null,
    consentVersion: CURRENT_BOOKING_CONSENT,
  });
});
