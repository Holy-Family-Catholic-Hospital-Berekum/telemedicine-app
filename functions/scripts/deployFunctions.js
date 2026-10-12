// functions/scripts/deployFunctions.js
//
// Deploys only the Cloud Functions whose code changed since the last
// deploy to that project, instead of rebuilding all of them (a full deploy
// rebuilds ~55 functions and takes about 10 minutes).
//
//   npm run deploy:functions                    test project (the default)
//   npm run deploy:functions -- --project live  live project
//   ... -- --dry-run                            only show what would deploy
//   ... -- --all                                deploy every function
//
// How it decides: the commit last deployed to each project is kept as the
// git tag `functions-deployed/<project id>`. Files changed since then are
// mapped to functions by following each function's require() chain, so a
// change to a shared file (lib/core.js, for example) deploys everything that
// uses it. A change to index.js, package*.json or a functions .env file, or
// no tag yet, deploys everything (that's also how removed functions get
// deleted). Uncommitted changes in functions/ are refused: what is deployed
// must be a commit, so the tag stays true.

const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { chooseProject, PROJECTS } = require("./project");

const FUNCTIONS_DIR = path.resolve(__dirname, "..");
const REPO = path.resolve(FUNCTIONS_DIR, "..");
const git = (...args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();

const { projectId, argv } = chooseProject(process.argv.slice(2));
const DRY = argv.includes("--dry-run");
const ALL = argv.includes("--all");
const alias = Object.keys(PROJECTS).find((k) => PROJECTS[k] === projectId) || projectId;
const TAG = `functions-deployed/${projectId}`;

// Files that change what is deployed for every function.
const EVERYTHING = [/^functions\/index\.js$/, /^functions\/package(-lock)?\.json$/, /^functions\/\.env/];
// Files that never affect a deployed function.
const IGNORED = [/^functions\/test\//, /^functions\/scripts\//, /\.md$/];

/** Local files a module requires, followed transitively. */
function dependencies(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
    let dep = path.resolve(path.dirname(file), m[1]);
    if (!dep.endsWith(".js") && !dep.endsWith(".json")) dep += ".js";
    if (fs.existsSync(dep)) dependencies(dep, seen);
  }
  return seen;
}

/** { functionName: module file } from index.js; jobs* map to every task module. */
function functionSources() {
  const index = fs.readFileSync(path.join(FUNCTIONS_DIR, "index.js"), "utf8");
  const vars = {};
  for (const m of index.matchAll(/const (\w+) = require\("(\.\/[^"]+)"\)/g)) vars[m[1]] = m[2];
  const out = {};
  for (const m of index.matchAll(/exports\.(\w+) = (\w+)\.(\w+);/g)) {
    if (vars[m[2]]) out[m[1]] = [vars[m[2]]];
  }
  for (const m of index.matchAll(/exports\.(\w+) = require\("(\.\/[^"]+)"\)\.\w+;/g)) out[m[1]] = [m[2]];
  // The scheduled jobs run the TASKS list: they depend on jobs.js and every
  // module a task comes from.
  const taskModules = new Set(["./jobs"]);
  const tasksBlock = index.slice(index.indexOf("const TASKS = ["));
  for (const m of tasksBlock.matchAll(/(\w+)\.\w+[,\s)]/g)) if (vars[m[1]]) taskModules.add(vars[m[1]]);
  for (const m of tasksBlock.matchAll(/require\("(\.\/[^"]+)"\)\.\w+/g)) taskModules.add(m[1]);
  for (const job of ["jobsEveryMinute", "jobsEvery15Minutes", "jobsDaily"]) out[job] = [...taskModules];
  const resolve = (rel) => path.join(FUNCTIONS_DIR, rel.endsWith(".js") ? rel : `${rel}.js`);
  return Object.fromEntries(Object.entries(out).map(([fn, mods]) => [fn, mods.map(resolve)]));
}

function deployedFunctionNames() {
  // The names the project would get, with that project's settings.
  const env = { ...process.env, GCLOUD_PROJECT: projectId };
  const envFile = path.join(FUNCTIONS_DIR, `.env.${projectId}`);
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (m) env[m[1]] = m[2];
    }
  }
  const out = execFileSync(process.execPath, ["-e", "console.log(JSON.stringify(Object.keys(require('./index.js'))))"], {
    cwd: FUNCTIONS_DIR,
    env,
    encoding: "utf8",
  });
  return JSON.parse(out.trim().split(/\r?\n/).pop());
}

function plan() {
  if (git("status", "--porcelain", "--", "functions")) {
    throw new Error("functions/ has uncommitted changes. Commit them first, so what's deployed is a commit.");
  }
  const head = git("rev-parse", "HEAD");
  let base;
  try {
    base = git("rev-parse", "--verify", "--quiet", `${TAG}^{commit}`);
  } catch {
    base = null; // no tag yet
  }
  const names = deployedFunctionNames();
  if (ALL) return { head, all: true, reason: "--all", names };
  if (!base) return { head, all: true, reason: `no ${TAG} tag yet (first deploy with this tool)`, names };
  if (base === head) return { head, names: [], reason: "nothing changed since the last deploy" };

  const changed = git("diff", "--name-only", `${base}..${head}`, "--", "functions")
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((f) => !IGNORED.some((re) => re.test(f)));
  if (changed.length === 0) return { head, names: [], reason: "only tests, scripts or docs changed" };
  const everything = changed.find((f) => EVERYTHING.some((re) => re.test(f)));
  if (everything) return { head, all: true, reason: `${everything} changed`, names, changed };

  const changedAbs = new Set(changed.map((f) => path.join(REPO, f)));
  const sources = functionSources();
  const unknown = names.filter((n) => !sources[n]);
  if (unknown.length) return { head, all: true, reason: `can't trace ${unknown.join(", ")} in index.js`, names, changed };
  const affected = names.filter((n) => {
    const deps = new Set();
    for (const file of sources[n]) dependencies(file, deps);
    return [...deps].some((d) => changedAbs.has(d));
  });
  return { head, names: affected, reason: `${changed.length} changed file(s)`, changed };
}

function main() {
  const p = plan();
  const changedIndexes = (() => {
    try {
      return git("diff", "--name-only", `${TAG}..HEAD`, "--", "firestore.indexes.json");
    } catch {
      return "";
    }
  })();
  console.log(`Last deployed: ${(() => { try { return git("log", "-1", "--format=%h %s", TAG); } catch { return "never (with this tool)"; } })()}`);
  if (p.changed) console.log(`Changed since then:\n  ${p.changed.join("\n  ")}`);
  if (changedIndexes) {
    console.log("\nNote: firestore.indexes.json changed. Deploy indexes first and wait until READY:");
    console.log(`  firebase deploy --only firestore:indexes --project ${alias}\n`);
  }
  if (!p.all && p.names.length === 0) {
    console.log(`Nothing to deploy: ${p.reason}.`);
    return;
  }
  const only = p.all ? "functions" : p.names.map((n) => `functions:${n}`).join(",");
  console.log(p.all ? `Deploying ALL functions (${p.reason}).` : `Deploying ${p.names.length} function(s): ${p.names.join(", ")}`);
  const args = ["--yes", "firebase-tools@15.31.0", "deploy", "--only", only, "--project", alias];
  console.log(`> npx ${args.join(" ")}`);
  if (DRY) return console.log("(dry run: nothing deployed)");

  const run = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", args, {
    cwd: REPO,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, FUNCTIONS_DISCOVERY_TIMEOUT: process.env.FUNCTIONS_DISCOVERY_TIMEOUT || "60" },
  });
  if (run.status !== 0) {
    console.error("\nDeploy failed: the deployed-commit tag was NOT moved. Fix and run again.");
    process.exit(run.status || 1);
  }
  git("tag", "-f", TAG, p.head);
  try {
    git("push", "-f", "origin", `refs/tags/${TAG}`);
  } catch {
    console.warn(`Couldn't push the tag ${TAG} to GitHub; run: git push -f origin refs/tags/${TAG}`);
  }
  console.log(`\nDone. ${TAG} now points at ${p.head.slice(0, 7)}.`);
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
