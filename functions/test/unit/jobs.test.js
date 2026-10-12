// The three scheduled jobs (jobs.js): which tasks run when, and that one
// failing task doesn't stop the others. Run: cd functions && npm test

const test = require("node:test");
const assert = require("node:assert/strict");
const { task } = require("../../lib/task");
const { runDue, jobFor, scheduledJobs } = require("../../jobs");

const at = (h, m) => new Date(Date.UTC(2026, 9, 12, h, m));

function fakeTasks(log) {
  const make = (name, schedule, fail = false) =>
    task(name, schedule, async () => {
      log.push(name);
      if (fail) throw new Error(`${name} broke`);
    });
  return {
    noShows: make("noShows", "every 1 minutes"),
    reminders: make("reminders", "every 5 minutes"),
    holds: make("holds", "every 15 minutes"),
    hourly: make("hourly", "every 60 minutes"),
    nightly: make("nightly", "every day 02:00"),
    sweep: make("sweep", "every 24 hours"),
  };
}

test("every minute: the 1-minute task always, the 5-minute task on minutes 0, 5, 10…", async () => {
  const log = [];
  const t = fakeTasks(log);
  const list = [t.noShows, t.reminders];
  assert.deepEqual((await runDue("jobsEveryMinute", list, at(10, 7))).ran, ["noShows"]);
  assert.deepEqual((await runDue("jobsEveryMinute", list, at(10, 10))).ran, ["noShows", "reminders"]);
  assert.deepEqual((await runDue("jobsEveryMinute", list, at(10, 0))).ran, ["noShows", "reminders"]);
});

test("every 15 minutes: hourly tasks only on the :00 run", async () => {
  const log = [];
  const t = fakeTasks(log);
  const list = [t.holds, t.hourly];
  assert.deepEqual((await runDue("jobsEvery15Minutes", list, at(9, 0))).ran, ["holds", "hourly"]);
  for (const m of [15, 30, 45]) {
    assert.deepEqual((await runDue("jobsEvery15Minutes", list, at(9, m))).ran, ["holds"]);
  }
});

test("each schedule belongs to exactly one job; unknown schedules are refused", () => {
  assert.equal(jobFor("every 1 minutes"), "jobsEveryMinute");
  assert.equal(jobFor("every 5 minutes"), "jobsEveryMinute");
  assert.equal(jobFor("every 15 minutes"), "jobsEvery15Minutes");
  assert.equal(jobFor("every 60 minutes"), "jobsEvery15Minutes");
  assert.equal(jobFor("every day 02:00"), "jobsDaily");
  assert.equal(jobFor("every 24 hours"), "jobsDaily");
  assert.throws(() => jobFor("every 7 minutes"), /No scheduled job/);
});

test("a failing task is reported, and the others still run", async () => {
  const log = [];
  const broken = task("broken", "every 1 minutes", async () => {
    log.push("broken");
    throw new Error("boom");
  });
  const fine = task("fine", "every 1 minutes", async () => log.push("fine"));
  const { ran, failed } = await runDue("jobsEveryMinute", [broken, fine], at(10, 1));
  assert.deepEqual(ran, ["broken", "fine"]);
  assert.deepEqual(failed, ["broken"]);
  assert.deepEqual(log.sort(), ["broken", "fine"]);
});

test("only three jobs are made, whatever the number of tasks", () => {
  const t = fakeTasks([]);
  const jobs = scheduledJobs(Object.values(t));
  assert.deepEqual(Object.keys(jobs).sort(), ["jobsDaily", "jobsEvery15Minutes", "jobsEveryMinute"]);
  assert.throws(() => scheduledJobs([async () => {}]), /made with task\(\)/);
});

test("every real task in index.js has a schedule a job runs", () => {
  const tasks = [
    require("../../noShow").autoMarkNoShows,
    require("../../noShow").closeExpiredNoShows,
    require("../../reconcile").reconcilePaystack,
    require("../../refundSync").syncPaystackRefunds,
    require("../../recordings").recoverStaleRecordings,
    ...["cleanupExpiredBookings", "releaseSlotHolds", "cleanupSignalling", "cleanupRateLimits"].map(
      (n) => require("../../maintenance")[n],
    ),
    require("../../email").retryQueuedEmails,
    require("../../reminders").sendAppointmentReminders,
  ];
  for (const t of tasks) assert.ok(t.taskName && jobFor(t.taskOptions.schedule), t.taskName);
});
