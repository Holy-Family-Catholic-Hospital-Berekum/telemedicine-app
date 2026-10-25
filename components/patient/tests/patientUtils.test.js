// Dashboard helpers (components/patient/dashboard/patientUtils.js).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  displayState,
  formatCurrency,
  formatGhs,
  getCallWindow,
  groupBookings,
  liveBookings,
  paymentsInProgress,
  slotBookingPath,
} from "../dashboard/patientUtils.js";
import { CALL_CLOSES_HOURS, CALL_UNLOCK_MINUTES } from "../../../src/constants.js";

const MINUTE = 60 * 1000;
const NOW = new Date(Date.UTC(2026, 9, 25, 12, 0, 0));
const at = (ms) => new Date(NOW.getTime() + ms);

test("getCallWindow: opens CALL_UNLOCK_MINUTES before, closes CALL_CLOSES_HOURS after", () => {
  const early = getCallWindow(at((CALL_UNLOCK_MINUTES + 1) * MINUTE), NOW);
  assert.deepEqual(early, { unlocked: false, closed: false, minutesUntilUnlock: 1 });
  assert.deepEqual(getCallWindow(at(CALL_UNLOCK_MINUTES * MINUTE), NOW), {
    unlocked: true,
    closed: false,
    minutesUntilUnlock: 0,
  });
  assert.equal(getCallWindow(at(-CALL_CLOSES_HOURS * 60 * MINUTE), NOW).closed, false);
  assert.equal(getCallWindow(at(-CALL_CLOSES_HOURS * 60 * MINUTE - 1), NOW).closed, true);
  // rounds up to whole minutes
  assert.equal(getCallWindow(at((CALL_UNLOCK_MINUTES + 90) * MINUTE + 1), NOW).minutesUntilUnlock, 91);
});

test("slotBookingPath: the slot's id, type, mode and doctor (if any)", () => {
  const slot = { slotId: "s1", type: "SURGICAL", mode: "in_person", doctorUid: "d 1" };
  assert.equal(slotBookingPath(slot), "/book?slotId=s1&type=SURGICAL&mode=in_person&doctor=d+1");
  assert.equal(
    slotBookingPath({ ...slot, doctorUid: null }),
    "/book?slotId=s1&type=SURGICAL&mode=in_person",
  );
});

test("formatCurrency always shows pesewas", () => {
  assert.equal(formatCurrency(150), "GHS 150.00");
  assert.equal(formatCurrency(7.5), "GHS 7.50");
  assert.equal(formatCurrency(undefined), "GHS 0.00");
});

test("formatGhs drops .00 on whole cedis", () => {
  assert.equal(formatGhs(150), "GHS 150");
  assert.equal(formatGhs(7.5), "GHS 7.50");
  assert.equal(formatGhs(0.25), "GHS 0.25");
  assert.equal(formatGhs(undefined), "GHS 0");
  assert.equal(formatGhs(NaN), "GHS 0");
});

test("displayState from the stored status", () => {
  assert.equal(displayState({ status: "awaiting_payment" }), "awaiting_payment");
  assert.equal(displayState({ status: "paid" }), "pending_assignment");
  assert.equal(displayState({ status: "no_show", patientJoinedAt: NOW }), "no_show");
  assert.equal(displayState({ status: "scheduled" }), "scheduled");
  assert.equal(displayState({ status: "scheduled", patientJoinedAt: NOW }), "in_progress");
});

test("groupBookings: scheduled (by time), missed and waiting; drafts in none", () => {
  const b = (id, state, scheduledTime) => ({ bookingId: id, state, scheduledTime });
  const bookings = [
    b("late", "scheduled", at(60 * MINUTE)),
    b("live", "in_progress", at(-5 * MINUTE)),
    b("missed", "no_show", at(-60 * MINUTE)),
    b("waiting", "pending_assignment", null),
    b("draft", "awaiting_payment", null),
    b("untimed", "scheduled", null),
  ];
  const groups = groupBookings(bookings);
  assert.deepEqual(groups.scheduled.map((x) => x.bookingId), ["untimed", "live", "late"]);
  assert.deepEqual(groups.missed.map((x) => x.bookingId), ["missed"]);
  assert.deepEqual(groups.waiting.map((x) => x.bookingId), ["waiting"]);
});

test("paymentsInProgress: drafts with a payment attempt only", () => {
  const bookings = [
    { bookingId: "tried", state: "awaiting_payment", txRefs: ["HFH-1"] },
    { bookingId: "untried", state: "awaiting_payment", txRefs: [] },
    { bookingId: "none", state: "awaiting_payment" },
    { bookingId: "paid", state: "pending_assignment", txRefs: ["HFH-2"] },
  ];
  assert.deepEqual(paymentsInProgress(bookings).map((x) => x.bookingId), ["tried"]);
});

test("liveBookings: video calls the patient can go back into", () => {
  const joined = {
    mode: "online",
    state: "in_progress",
    patientJoinedAt: at(-10 * MINUTE),
    scheduledTime: at(-10 * MINUTE),
  };
  const bookings = [
    { ...joined, bookingId: "live" },
    { ...joined, bookingId: "notJoined", state: "scheduled", patientJoinedAt: null },
    { ...joined, bookingId: "visit", mode: "in_person" },
    { ...joined, bookingId: "closed", scheduledTime: at(-(CALL_CLOSES_HOURS * 60 + 1) * MINUTE) },
    // Joined, then marked missed: nothing to rejoin.
    { ...joined, bookingId: "missed", state: "no_show" },
    // The doctor can't come, or the call couldn't be completed.
    { ...joined, bookingId: "doctorAway", doctorUnavailable: { kind: "doctor_absent" } },
    { ...joined, bookingId: "incomplete", doctorUnavailable: { kind: "call_incomplete" } },
  ];
  assert.deepEqual(liveBookings(bookings, NOW).map((x) => x.bookingId), ["live"]);
});
