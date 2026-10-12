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
import { writeFileSync } from "node:fs";
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
const inner = `npx playwright test -c e2e/playwright.config.mjs ${extra}`.trim();
// One command line (the inner command quoted as one argument) for every OS.
const command =
  "npx --yes firebase-tools@15.31.0 emulators:exec --only auth,firestore,functions,storage " +
  `--project demo-telemedicine "${inner}"`;
// deepcode ignore IndirectCommandInjection: the only input is the developer's own arguments, limited to SAFE_ARG above.
const result = spawnSync(command, { cwd: root, stdio: "inherit", shell: true });
process.exit(result.status ?? 1);
