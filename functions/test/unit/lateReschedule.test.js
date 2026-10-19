// Late reschedules (lib/consultationLifecycle.js rescheduleNeedsLateFee)
// and how emails explain them. Run: cd functions && npm test

const test = require("node:test");
const assert = require("node:assert/strict");
const { rescheduleNeedsLateFee, rescheduleCountsAsNoShow } = require("../../lib/consultationLifecycle");
const { renderEmail } = require("../../lib/emailTemplates");

const HOUR = 3600 * 1000;
const now = Date.UTC(2026, 9, 20, 9, 0);
const startingIn = (ms, extra = {}) => ({ mode: "online", scheduledTime: new Date(now + ms), ...extra });

test("free up to 24 hours before; the fee from then until the start", () => {
  assert.equal(rescheduleNeedsLateFee(startingIn(25 * HOUR), {}, 50, now), false);
  assert.equal(rescheduleNeedsLateFee(startingIn(24 * HOUR), {}, 50, now), false);
  assert.equal(rescheduleNeedsLateFee(startingIn(24 * HOUR - 1), {}, 50, now), true);
  assert.equal(rescheduleNeedsLateFee(startingIn(10 * 60 * 1000), {}, 50, now), true);
});

test("from the start on it's the no-show rule, not the late fee", () => {
  assert.equal(rescheduleNeedsLateFee(startingIn(0), {}, 50, now), false);
  assert.equal(rescheduleNeedsLateFee(startingIn(-HOUR), {}, 50, now), false);
  // The doctor waiting for the patient after the start: no-show.
  assert.equal(
    rescheduleCountsAsNoShow(startingIn(-HOUR, { waitDeadline: { for: "patient" } }), 5, now),
    true,
  );
});

test("always free: no fee set, pay at the hospital, doctor couldn't make it, already asked, took place", () => {
  const soon = startingIn(2 * HOUR);
  assert.equal(rescheduleNeedsLateFee(soon, {}, 0, now), false);
  assert.equal(rescheduleNeedsLateFee(soon, { payAtHospital: true }, 50, now), false);
  assert.equal(rescheduleNeedsLateFee(soon, { doctorUnavailable: { kind: "call_incomplete" } }, 50, now), false);
  assert.equal(rescheduleNeedsLateFee({ ...soon, doctorUnavailable: { kind: "doctor_absent" } }, {}, 50, now), false);
  assert.equal(rescheduleNeedsLateFee(soon, { rescheduleRequest: { status: "requested" } }, 50, now), false);
  assert.equal(rescheduleNeedsLateFee({ ...soon, metAt: new Date(now) }, {}, 50, now), false);
  // A declined earlier request doesn't make a new one free.
  assert.equal(rescheduleNeedsLateFee(soon, { rescheduleRequest: { status: "declined" } }, 50, now), true);
});

test("appointment emails state the 24-hour rule (not for visits paid at the hospital)", () => {
  const base = {
    scheduledAt: now + 48 * HOUR,
    type: "OPD",
    mode: "online",
    consultationId: "HFC-TEST",
    doctorName: "Dr. Test",
    noShow: { waitMinutes: 5, rescheduleFee: 50, forfeitPercent: 20 },
  };
  assert.match(renderEmail("appointment_scheduled", base).text, /free up to 24 hours before your appointment; after that it costs GHS 50/);
  const free = renderEmail("appointment_scheduled", { ...base, mode: "in_person", payAtHospital: true, amountDue: 100 }).text;
  assert.doesNotMatch(free, /24 hours/);
});
