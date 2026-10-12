// Which reminder emails are due (reminders.js dueReminders).
// Run: cd functions && npm test

const test = require("node:test");
const assert = require("node:assert/strict");
const { Timestamp } = require("firebase-admin/firestore");
const { dueReminders } = require("../../reminders");

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const START = Date.UTC(2026, 9, 10, 10, 0);
const base = (extra = {}) => ({
  mode: "online",
  scheduledTime: Timestamp.fromMillis(START),
  scheduleSetAt: Timestamp.fromMillis(START - 3 * 24 * HOUR),
  ...extra,
});
const keys = (list) => list.map((r) => r.key).sort();

test("about a day before: the 24 h reminder to both sides", () => {
  assert.deepEqual(keys(dueReminders(base(), START - 20 * HOUR, 5)), ["doctor24h", "patient24h"]);
});

test("about an hour before: the 1 h reminder to both sides", () => {
  assert.deepEqual(keys(dueReminders(base(), START - 40 * MIN, 5)), ["doctor1h", "patient1h"]);
});

test("already sent reminders are not sent again", () => {
  const c = base({ reminders: { doctor1h: Timestamp.now(), patient1h: Timestamp.now() } });
  assert.deepEqual(dueReminders(c, START - 40 * MIN, 5), []);
});

test("just scheduled: no reminder straight after the confirmation email", () => {
  const c = base({ scheduleSetAt: Timestamp.fromMillis(START - 50 * MIN) });
  assert.deepEqual(dueReminders(c, START - 40 * MIN, 5), []);
});

test("a minute after the start: 'not joined' to whoever hasn't joined, with the deadline", () => {
  const c = base({ patientFirstJoinedAt: Timestamp.fromMillis(START), waitDeadline: { for: "doctor", at: Timestamp.fromMillis(START + 5 * MIN) } });
  const due = dueReminders(c, START + 2 * MIN, 5);
  assert.deepEqual(keys(due), ["doctorLate"]);
  assert.equal(due[0].by, START + 5 * MIN);
});

test("no reminders for a consultation the doctor couldn't make, or one that took place", () => {
  assert.deepEqual(dueReminders(base({ doctorUnavailable: { kind: "doctor_absent" } }), START - 40 * MIN, 5), []);
  assert.deepEqual(dueReminders(base({ metAt: Timestamp.fromMillis(START) }), START + 2 * MIN, 5), []);
});
