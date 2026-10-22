// End-to-end tests: `npm run test:e2e` (needs Java 21 for the emulators).
//
// Starts the Firebase emulators (Auth, Firestore, Functions, Storage) with
// the throwaway project demo-telemedicine, then runs the Playwright robot
// (e2e/tests) against a build of the website that talks to them. Nothing
// reaches the test or live projects, Paystack or any email service.
//
// The emulated functions need values for their secrets: dummy ones are
// written to functions/.secret.local (git-ignored) for the run.

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
writeFileSync(
  path.join(root, "functions", ".secret.local"),
  [
    "PAYSTACK_SECRET_KEY=sk_test_e2e_dummy",
    "CLOUDFLARE_TURN_KEY_ID=e2e-dummy",
    "CLOUDFLARE_TURN_API_TOKEN=e2e-dummy",
    "RESEND_API_KEY=re_e2e_dummy",
    "BREVO_API_KEY=e2e-dummy",
    "",
  ].join("\n"),
);

// Extra arguments go to Playwright (e.g. a test file name or --headed).
// They end up on a shell command line, so only plain characters are allowed.
const extraArgs = process.argv.slice(2);
const SAFE_ARG = /^[A-Za-z0-9._\-/=:]+$/;
const unsafe = extraArgs.find((a) => !SAFE_ARG.test(a));
if (unsafe) {
  console.error(`Not allowed as a test argument: ${JSON.stringify(unsafe)}`);
  process.exit(2);
}
const extra = extraArgs.join(" ");
// emulators:exec runs this one string as its own command line (hence
// SAFE_ARG above).
const inner = `npx playwright test -c e2e/playwright.config.mjs ${extra}`.trim();

// npx without a shell: Node runs npm's own npx script, with the arguments
// as a list. (On Windows npx is a .cmd file, which can't be started
// without a shell.)
const npxCli = [
  process.env.npm_execpath && path.join(path.dirname(process.env.npm_execpath), "npx-cli.js"),
  path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js"),
].find((p) => p && existsSync(p));
if (!npxCli) {
  console.error("Couldn't find npm's npx: run this with `npm run test:e2e`.");
  process.exit(2);
}
const result = spawnSync(
  process.execPath,
  [
    npxCli,
    "--yes",
    "firebase-tools@15.31.0",
    "emulators:exec",
    "--only",
    "auth,firestore,functions,storage",
    "--project",
    "demo-telemedicine",
    inner,
  ],
  { cwd: root, stdio: "inherit" },
);
process.exit(result.status ?? 1);
