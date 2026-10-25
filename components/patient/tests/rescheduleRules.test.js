// When the patient's own reschedule costs a fee (components/patient/dashboard/rescheduleRules.js).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FREE_RESCHEDULE_HOURS,
  freeChangeUntil,
  inFreeHour,
  isLate,
  needsLateFee,
} from "../dashboard/rescheduleRules.js";

const HOUR = 3600 * 1000;
const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const at = (ms) => new Date(NOW + ms);

// A booked video call whose time was given long ago.
const booking = (startIn, extra = {}) => ({
  mode: "online",
  scheduledTime: at(startIn),
  scheduleSetAt: at(-7 * 24 * HOUR),
  ...extra,
});

test("the free window is 24 hours", () => {
  assert.equal(FREE_RESCHEDULE_HOURS, 24);
});

test("isLate: only after the start, while the doctor is waiting (video) or at all (visit)", () => {
  assert.equal(isLate(booking(HOUR), NOW), false);
  assert.equal(isLate(booking(-HOUR), NOW), false);
  assert.equal(isLate(booking(-HOUR, { waitDeadline: { for: "patient" } }), NOW), true);
  assert.equal(isLate(booking(-HOUR, { waitDeadline: { for: "doctor" } }), NOW), false);
  assert.equal(isLate(booking(-HOUR, { mode: "in_person" }), NOW), true);
  assert.equal(isLate(booking(0, { mode: "in_person" }), NOW), true); // at the start itself
});

test("isLate: not once the two met, a request is open, or there's no time", () => {
  const waiting = { waitDeadline: { for: "patient" } };
  assert.equal(isLate(booking(-HOUR, { ...waiting, metAt: at(-HOUR) }), NOW), false);
  assert.equal(isLate(booking(-HOUR, { ...waiting, rescheduleRequest: { status: "requested" } }), NOW), false);
  assert.equal(isLate({ mode: "in_person", scheduledTime: null }, NOW), false);
});

test("freeChangeUntil: a time given under 24 hours ahead is free for its first hour", () => {
  assert.equal(freeChangeUntil(booking(30 * HOUR)), null); // given long ago
  const shortNotice = booking(10 * HOUR, { scheduleSetAt: at(-15 * 60 * 1000) });
  assert.deepEqual(freeChangeUntil(shortNotice), at(45 * 60 * 1000));
  // exactly 24 hours ahead is not short notice
  assert.equal(freeChangeUntil(booking(24 * HOUR, { scheduleSetAt: at(0) })), null);
  assert.equal(freeChangeUntil(booking(10 * HOUR, { scheduleSetAt: null })), null);
  assert.equal(inFreeHour(shortNotice, NOW), true);
  assert.equal(inFreeHour(shortNotice, NOW + HOUR), false);
});

test("needsLateFee: less than 24 hours before the start", () => {
  assert.equal(needsLateFee(booking(30 * HOUR), NOW), false);
  assert.equal(needsLateFee(booking(24 * HOUR), NOW), false); // exactly 24 hours: still free
  assert.equal(needsLateFee(booking(24 * HOUR - 1), NOW), true);
  assert.equal(needsLateFee(booking(HOUR), NOW), true);
  assert.equal(needsLateFee(booking(0), NOW), false); // from the start on, the no-show rule
  assert.equal(needsLateFee(booking(-HOUR), NOW), false);
});

test("needsLateFee: free cases", () => {
  assert.equal(needsLateFee(booking(HOUR, { payAtHospital: true }), NOW), false);
  assert.equal(needsLateFee(booking(HOUR, { doctorUnavailable: { kind: "doctor_absent" } }), NOW), false);
  assert.equal(needsLateFee(booking(HOUR, { rescheduleRequest: { status: "requested" } }), NOW), false);
  assert.equal(needsLateFee(booking(HOUR, { metAt: at(0) }), NOW), false);
  assert.equal(needsLateFee({ mode: "online", scheduledTime: null }, NOW), false);
  const shortNotice = booking(10 * HOUR, { scheduleSetAt: at(-15 * 60 * 1000) });
  assert.equal(needsLateFee(shortNotice, NOW), false); // in its free hour
  assert.equal(needsLateFee(shortNotice, NOW + HOUR), true); // after it
});
