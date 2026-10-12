// functions/scripts/project.js
//
// Which Firebase project an owner script acts on. The default is the TEST
// project; the live one is used only when asked for explicitly:
//
//   node scripts/staffAdmin.js make-admin a@b.org "Name"                 -> test
//   node scripts/staffAdmin.js make-admin a@b.org "Name" --project live  -> live
//
// `--project` takes live, test or a full project ID (anywhere on the
// command line). GCLOUD_PROJECT set in the environment also counts as
// explicit. The chosen project is printed before anything happens.

const PROJECTS = { test: "telemedicine-hfch-test", live: "telemedicine-hfch" };

/** Reads and removes --project from argv. Returns { projectId, argv }. */
function chooseProject(argv) {
  const rest = [];
  let asked = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project") {
      asked = argv[i + 1];
      i++;
    } else if (a.startsWith("--project=")) {
      asked = a.slice("--project=".length);
    } else {
      rest.push(a);
    }
  }
  if (asked !== null && !asked) throw new Error("--project needs a value: live or test.");
  const projectId = asked
    ? PROJECTS[asked] || asked
    : process.env.GCLOUD_PROJECT || PROJECTS.test;
  // lib/core reads this too (runtime service account name).
  process.env.GCLOUD_PROJECT = projectId;
  const label = projectId === PROJECTS.live ? "LIVE" : projectId === PROJECTS.test ? "test" : "other";
  console.error(`Project: ${projectId} (${label})`);
  return { projectId, argv: rest };
}

module.exports = { chooseProject, PROJECTS };
