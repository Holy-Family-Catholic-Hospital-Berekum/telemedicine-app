// The video-call waiting rule (lib/consultationLifecycle.js), hospital
// decision: nobody in the room by start + W is the doctor's no-show; when
// one side arrives the other has until max(start, arrival) + W; once both
// were connected (metAt) no deadline applies. W = 5 minutes here.
// Run: cd functions && npm test

const test = require("node:test");
const assert = require("node:assert/strict");
const { Timestamp } = require("firebase-admin/firestore");
const {
  waitDeadline,
  deadlineFrom,
  isPresent,
  rescheduleCountsAsNoShow,
  PRESENCE_TTL_MS,
} = require("../../lib/consultationLifecycle");

const MIN = 60 * 1000;
const W = 5;
const START = Date.UTC(2026, 9, 10, 10, 0); // 10:00
const ts = (ms) => Timestamp.fromMillis(ms);
const online = (extra = {}) => ({ mode: "online", scheduledTime: ts(START), ...extra });

test("nobody has joined: the doctor has until start + W", () => {
  assert.deepEqual(waitDeadline(online(), W), { for: "doctor", at: START + 5 * MIN });
});

test("an explicit deadline (one side arrived) is used as set", () => {
  const c = online({ patientFirstJoinedAt: ts(START + 3 * MIN), waitDeadline: { for: "doctor", at: ts(START + 8 * MIN) } });
  assert.deepEqual(waitDeadline(c, W), { for: "doctor", at: START + 8 * MIN });
});

test("once the two were connected there is no deadline", () => {
  const c = online({ metAt: ts(START + 2 * MIN), waitDeadline: { for: "doctor", at: ts(START + 8 * MIN) } });
  assert.equal(waitDeadline(c, W), null);
});

test("someone joined and no countdown is running: no deadline", () => {
  assert.equal(waitDeadline(online({ doctorFirstJoinedAt: ts(START) }), W), null);
});

test("hospital visit: the patient has start + W", () => {
  assert.deepEqual(waitDeadline({ mode: "in_person", scheduledTime: ts(START) }, W), {
    for: "patient",
    at: START + 5 * MIN,
  });
});

test("arriving at 10:03 gives the other side until 10:08", () => {
  assert.equal(deadlineFrom(online(), W, START + 3 * MIN), START + 8 * MIN);
});

test("arriving early counts as arriving at the start time", () => {
  assert.equal(deadlineFrom(online(), W, START - 20 * MIN), START + 5 * MIN);
});

test("presence lasts PRESENCE_TTL_MS after the last check-in", () => {
  const now = START + 10 * MIN;
  const c = online({ presence: { doctor: ts(now - PRESENCE_TTL_MS + 1000), patient: ts(now - PRESENCE_TTL_MS - 1000) } });
  assert.equal(isPresent(c, "doctor", now), true);
  assert.equal(isPresent(c, "patient", now), false);
  assert.equal(isPresent(online(), "doctor", now), false);
});

test("late reschedule counts as a no-show only while the doctor waits for the patient", () => {
  const after = START + 2 * MIN;
  assert.equal(rescheduleCountsAsNoShow(online(), W, START - MIN), false, "before the start: free");
  assert.equal(rescheduleCountsAsNoShow(online(), W, after), false, "nobody there: doctor's fault, free");
  assert.equal(
    rescheduleCountsAsNoShow(online({ waitDeadline: { for: "doctor", at: ts(START + 8 * MIN) } }), W, after),
    false,
    "patient waiting for the doctor: free",
  );
  assert.equal(
    rescheduleCountsAsNoShow(online({ waitDeadline: { for: "patient", at: ts(START + 7 * MIN) } }), W, after),
    true,
    "doctor waiting for the patient: no-show fee",
  );
  assert.equal(rescheduleCountsAsNoShow(online({ metAt: ts(START) }), W, after), false, "took place");
});

test("hospital visit: a reschedule from the start time on counts as a no-show", () => {
  const visit = { mode: "in_person", scheduledTime: ts(START) };
  assert.equal(rescheduleCountsAsNoShow(visit, W, START - MIN), false);
  assert.equal(rescheduleCountsAsNoShow(visit, W, START + MIN), true);
});
