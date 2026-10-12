// The three scheduled jobs that run every background task (lib/task.js).
//
// Cloud Scheduler gives each billing account three jobs free, so instead of
// one job per task the tasks are grouped by how often they run:
//
//   jobsEveryMinute     every minute       "every 1 minutes" tasks, and
//                                          "every 5 minutes" tasks on minutes 0, 5, 10…
//   jobsEvery15Minutes  :00 :15 :30 :45    "every 15 minutes" tasks, and
//                                          "every 60 minutes" tasks at :00
//   jobsDaily           02:00 Ghana time   "every day 02:00" and "every 24 hours" tasks
//
// Times come from Cloud Scheduler's own schedule time, so a late start
// never skips or repeats a task. The tasks of a run start together and are
// independent: one failing is logged (and alerted, as a function error)
// without stopping the others. Each job gets the union of its tasks'
// secrets and the largest time limit and memory they ask for.
// index.js deploys these only where SCHEDULED_JOBS isn't "off".

const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");

const TIME_ZONE = "Africa/Accra";
const JOBS = {
  jobsEveryMinute: {
    cron: "* * * * *",
    runs: {
      "every 1 minutes": () => true,
      "every 5 minutes": (d) => d.getUTCMinutes() % 5 === 0,
    },
  },
  jobsEvery15Minutes: {
    cron: "*/15 * * * *",
    runs: {
      "every 15 minutes": () => true,
      "every 60 minutes": (d) => d.getUTCMinutes() < 15,
    },
  },
  jobsDaily: {
    cron: "0 2 * * *",
    runs: {
      "every day 02:00": () => true,
      "every 24 hours": () => true,
    },
  },
};
const MEMORY = ["256MiB", "512MiB", "1GiB", "2GiB", "4GiB"];
const MAX_TIMEOUT = 540;

/** The job a schedule belongs to; throws on a schedule no job runs. */
function jobFor(schedule) {
  const name = Object.keys(JOBS).find((j) => schedule in JOBS[j].runs);
  if (!name) throw new Error(`No scheduled job runs "${schedule}" (see jobs.js).`);
  return name;
}

/** Runs the tasks due at `when`, each on its own; resolves to their outcomes. */
async function runDue(jobName, tasks, when) {
  const due = tasks.filter((t) => JOBS[jobName].runs[t.taskOptions.schedule](when));
  const outcomes = await Promise.allSettled(
    due.map(async (t) => {
      const started = Date.now();
      await t({ scheduleTime: when.toISOString() });
      return { task: t.taskName, ms: Date.now() - started };
    }),
  );
  const failed = [];
  outcomes.forEach((o, i) => {
    if (o.status === "rejected") {
      failed.push(due[i].taskName);
      logger.error("Scheduled task failed", {
        job: jobName,
        task: due[i].taskName,
        error: o.reason?.stack || String(o.reason),
      });
    }
  });
  return { ran: due.map((t) => t.taskName), failed };
}

/** { jobsEveryMinute, jobsEvery15Minutes, jobsDaily } for the given tasks. */
function scheduledJobs(tasks) {
  const byJob = Object.fromEntries(Object.keys(JOBS).map((j) => [j, []]));
  for (const t of tasks) {
    if (!t?.taskName) throw new Error("jobs.js: every scheduled task must be made with task() (lib/task.js).");
    byJob[jobFor(t.taskOptions.schedule)].push(t);
  }

  const out = {};
  for (const [jobName, list] of Object.entries(byJob)) {
    if (list.length === 0) continue;
    const secrets = [...new Map(list.flatMap((t) => t.taskOptions.secrets || []).map((s) => [s.name, s])).values()];
    const timeoutSeconds = Math.min(MAX_TIMEOUT, Math.max(60, ...list.map((t) => t.taskOptions.timeoutSeconds || 60)));
    const memory = MEMORY[Math.max(0, ...list.map((t) => MEMORY.indexOf(t.taskOptions.memory || "256MiB")))];
    out[jobName] = onSchedule(
      { schedule: JOBS[jobName].cron, timeZone: TIME_ZONE, secrets, timeoutSeconds, memory, retryCount: 0 },
      async (event) => {
        const when = new Date(event?.scheduleTime || Date.now());
        const { ran, failed } = await runDue(jobName, list, when);
        if (failed.length) throw new Error(`${jobName}: ${failed.length} of ${ran.length} task(s) failed: ${failed.join(", ")}`);
      },
    );
  }
  return out;
}

module.exports = { scheduledJobs, runDue, jobFor, JOBS };
