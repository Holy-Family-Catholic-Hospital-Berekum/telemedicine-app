// A scheduled task: a plain handler labelled with how often it should run.
// Tasks are not deployed one by one: jobs.js runs all of them from three
// Cloud Scheduler jobs (every minute / every 15 minutes / daily at 02:00),
// which keeps the project inside Cloud Scheduler's three free jobs.
//
//   exports.releaseSlotHolds = task("releaseSlotHolds", "every 15 minutes", async () => { ... });
//   exports.syncPaystackRefunds = task("syncPaystackRefunds",
//     { schedule: "every 15 minutes", secrets: [PAYSTACK_SECRET_KEY], timeoutSeconds: 300 }, syncAll);
//
// schedule: one of the keys of SCHEDULES in jobs.js. Optional secrets,
// timeoutSeconds and memory are given to the job that runs the task.

function task(name, options, handler) {
  const taskOptions = typeof options === "string" ? { schedule: options } : { ...options };
  const run = (event) => handler(event);
  run.taskName = name;
  run.taskOptions = taskOptions;
  return run;
}

module.exports = { task };
