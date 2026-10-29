# Handover guide

For a developer taking over the telemedicine system. Read
[README.md](README.md) first for what the system is; this file is how to
get access, run it, change it and deploy it. Day-to-day operations
(staff accounts, lost phones, restores, payments go-live) are in
[SECURITY_SETUP.md](SECURITY_SETUP.md).

## 1. Accounts and access to hand over

The hospital (not a person) should own every one of these; the departing
developer adds the new one and then removes themselves.

| Service | What for | Access the new developer needs |
|---|---|---|
| **GitHub** organisation `Holy-Family-Catholic-Hospital-Berekum`, repo `telemedicine-app` | Source code, CI | Member with write access (owner: hospital IT) |
| **Google Cloud / Firebase** projects `telemedicine-hfch` (live) and `telemedicine-hfch-test` (test) | Back end, database, auth, logs, alerts, budget | IAM role *Owner* or *Editor* on both (Owner is needed for the staffAdmin script and IAM changes) |
| **Google Cloud billing** account (Firebase Payment) | Pays for Firebase; budget alerts | *Billing account viewer* at least |
| **Paystack** dashboard | Payments, refunds, webhook URL, API keys | Developer role |
| **Brevo** | Emails (since 13 Oct 2026; free plan 300/day); API keys `telemedicine-live` / `telemedicine-test`; domain `mail.hfhberekum.org` authenticated; **Authorised IPs must stay off** (Google's servers change address) | Team member |
| **Resend** | Previous email service, kept for a few days as a fallback; remove its keys and DNS records once Brevo has run without problems | Team member |
| **Cloudflare** account `hfhberekum.org` | DNS (website, email records), TURN video relay key | Member with DNS + Calls/TURN access |
| **Snyk, GitGuardian** | Security scans used by CI (tokens stored as GitHub secrets) | Optional |
| A **staff test account** on the live site | Testing the portals | An admin creates it; needs an authenticator app |

Secrets never live in the repo:

| Secret | Where it lives | Set with |
|---|---|---|
| Paystack secret key | Firebase function secret `PAYSTACK_SECRET_KEY` | `firebase functions:secrets:set PAYSTACK_SECRET_KEY --project live` |
| Brevo API key | Firebase function secret `BREVO_API_KEY` (one key per project) | `firebase functions:secrets:set BREVO_API_KEY --project live` (or `--project test`); the service is chosen by `MAIL_PROVIDER` in `functions/.env.<project id>` |
| Cloudflare TURN | Function secrets `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN` | same command |
| Website settings | `.env` locally; GitHub → Settings → Environments `live` / `test` (variables, and the secret `VITE_STAFF_LOGIN_PATH`) | see `.env.example` and "Website deploys" below |
| CI tokens | GitHub repo secrets `SNYK_TOKEN`, `GITGUARDIAN_API_KEY` | GitHub → Settings → Secrets |

## 2. First-time setup (Windows, macOS or Linux)

1. Install **Node.js 22+** (functions run on Node 24 in the cloud),
   **Git**, the **Firebase CLI** (`npm install -g firebase-tools`) and the
   **Google Cloud CLI** (`gcloud`). For rules tests also **Java 21**. For
   the pre-commit hook, **TruffleHog** on your PATH (the hook refuses to
   commit without it).
2. Clone and install:
   ```bash
   git clone https://github.com/Holy-Family-Catholic-Hospital-Berekum/telemedicine-app.git
   cd telemedicine-app
   npm install
   cd functions && npm install && cd ..
   ```
3. Sign in to the tools: `firebase login`, `gcloud auth login`, and for
   scripts that use the Admin SDK `gcloud auth application-default login`.
   `firebase use` should show `test` (`telemedicine-hfch-test`).
4. Create `.env` from `.env.example` with the **test** project's values
   (`firebase apps:sdkconfig WEB --project test`, the GitHub `test`
   environment; the staff path from the hospital).
5. **App Check:** it's enforced on both projects, so local development
   needs a debug token: Firebase console → **test project** → App Check →
   Apps → web app → *Manage debug tokens* → add one, put it in `.env` as
   `VITE_APPCHECK_DEBUG_TOKEN`. Delete it when you stop developing. Never
   add one to the live project.
6. `npm run dev` → http://localhost:5173.

Local development always talks to the **test** project (its own database,
accounts and test payments; see "Test environment" in section 4). Live's
browser key doesn't accept `localhost`, so a computer can't reach real
patients' data by mistake.

## 3. Making a change

1. Branch or work on `main` (one developer: direct pushes are allowed;
   force-pushes and deleting `main` are blocked).
2. `npm run lint` and `npm run build` must pass. The pre-commit hook runs
   a secret scan and lint on staged files. If TruffleHog blocks a commit
   but lists no finding, it's a known glitch: just commit again.
3. Tests (GitHub runs all but the patient-page tests on pushes to `main`
   or `test` that touch the code they cover):
   - `cd functions && npm test`: server unit tests (waiting rule, refund
     amounts, age, reminders, late reschedule fee, prescriptions,
     caller IP, sign-in alerts, metrics report, scheduled jobs, email
     services, error scrubbing). No setup.
   - `npm run test:patient`: the patient pages' own logic (booking form
     checks, reschedule fee rules, dashboard grouping) with Node's test
     runner. No setup, a second or two; **run it yourself** after changing
     `components/patient/` (GitHub doesn't).
   - `npm run test:functions` / `npm run test:rules`: server and database
     rules tests on the Firebase emulators (need Java 21). Changing rules:
     add a test in `tests/rules/rules.test.mjs`.
   - `npm run test:e2e`: the **robot** (Playwright, `e2e/`) uses the
     website like a patient on a throwaway copy of the whole system:
     sign-up, booking and payment, joining a video call, the
     doctor-waiting and doctor-missing rules, a refund request. About 4
     minutes; needs Java 21. Paystack's own payment window can't be
     automated, so it is stood in for; check it by hand before go-live.
     Staff steps call the real staff functions with a token only the
     emulator accepts (staff need an authenticator). A run contacts no
     outside service (email, Paystack and the video relay are switched off
     in `functions/.env.demo-telemedicine`, emulator only).
   - *Build* (GitHub) lints and builds the website on every push.
   - *Security audit* (GitHub: TruffleHog, ESLint, Semgrep, Snyk,
     GitGuardian) runs on every push and must pass before the website is
     published. Before pushing, a Snyk scan of your changes is worthwhile.
   Try risky changes on the **test environment** first (section 4).
4. Keep [CLAUDE.md](CLAUDE.md) up to date when behaviour changes; it's the
   reference the next person (or an AI assistant) relies on.
5. Patient-facing text: plain words for lay readers, at least 14 px.
   Legal and consent text: see "Versioned texts" below.

### Versioned texts (don't break these)

- **Consent wording** (`src/consentText.js` and `functions/lib/consentText.js`,
  which must be identical): never edit a published version; add a new
  version in both files and bump the `CURRENT_…` constant.
- **Terms and privacy policy:** the built-in text is
  `components/admin/legalDefaults.js`, but a copy saved by an admin in
  Control panel → Legal overrides it. After changing the built-in text,
  an admin publishes it with *Start from the built-in text* → *Review and
  save*.
- **Audit codes** (`code:` in `audit(...)` calls): the security alert
  filter matches them; don't rename existing ones.

## 4. Deploying

| What | How | Notes |
|---|---|---|
| Website | `git push` to `main` (live) or `test` | GitHub Actions *Deploy website* builds and publishes to Firebase Hosting in a few minutes (see "Website deploys"). Check the run on GitHub → Actions. Pushes that only touch functions, tests, rules or docs don't redeploy it. |
| Functions | `npm run deploy:functions -- --project live` (test: without `--project`) | Deploys only the functions whose code changed since the last deploy to that project (git tag `functions-deployed/<project>`), and everything when `index.js`, `package*.json` or an env file changed. Commit first. `-- --dry-run` shows what would deploy; `-- --all` forces everything. The full command is `FUNCTIONS_DISCOVERY_TIMEOUT=60 firebase deploy --only functions --project live`; a change that raises the minimum bill (e.g. `minInstances`) needs `--force`. |
| Database / storage rules | `firebase deploy --only firestore:rules,storage --project live` | Rules are live immediately. |
| Indexes | `firebase deploy --only firestore:indexes --project live` | Deploy new indexes **before** functions that need them and wait until they show READY (`gcloud firestore indexes composite list`), or the queries fail meanwhile. |

**The default is the TEST project.** Every Firebase command and owner
script acts on `telemedicine-hfch-test` unless you add `--project live`
(`.firebaserc` default + `firebase use test`; the scripts print the project
first). A forgotten flag therefore lands in test, never in live.
**Local development also uses the test project** (`.env` holds the test
web config), and live's browser key no longer accepts `localhost`, so
nothing run on a developer's computer can reach real patients' data.

After deploying functions, watch Cloud Logging for errors for a few
minutes; the *Telemedicine function errors* alert emails the owner too.

### Test environment

A second Firebase project, **`telemedicine-hfch-test`** ("Telemedicine
TEST"), set up like live (eur3 database, Identity Platform with
authenticator apps and the password policy, Storage, the
`functions-runtime` account with the same roles), with its own empty
database and its own accounts. Use it to try a change before live:

```bash
firebase deploy --only firestore,storage --project test
FUNCTIONS_DISCOVERY_TIMEOUT=60 firebase deploy --only functions --project test
```

- **Free:** `functions/.env.telemedicine-hfch-test` (committed, not secret)
  sets `SCHEDULED_JOBS=off`, so none of the scheduled jobs (automatic
  no-shows, reminders, nightly Paystack check, clean-ups) are deployed
  there; their logic is covered by the automated tests. Usage stays in the
  free tier, and the USD 50 budget alert covers both projects. It also sets
  `SITE_URL` (links in its emails) and `PAYMENT_REF_PREFIX=HFT` (below).
- **Website:** https://telemedicine-hfch-test.web.app (Firebase Hosting
  in the test project), published by GitHub Actions on every push to
  `test`. To try a change, push it to `test` (`git push origin main:test`,
  or a feature branch merged into `test`) and deploy the functions with
  `--project test`. Its settings are in the GitHub environment `test`: the
  test project's web config (`firebase apps:sdkconfig WEB --project test`),
  the Paystack **test** public key, its own staff path and its own
  reCAPTCHA site key. **The test site is public** (Firebase Hosting has no
  password protection): it's kept out of search
  engines (`VITE_SEARCH_INDEXING=off`: robots.txt and every page noindex),
  and only ever holds test data and test payments.
- **Same security as live:** App Check is enforced on the test database,
  storage, sign-in and functions (own reCAPTCHA Enterprise key); the
  browser key only works from the test site, `localhost:5173` and
  `telemedicine-hfch-test.firebaseapp.com`; authenticator apps and the
  password policy as on live.
- **Secrets:** the test project has its **own** Brevo and Cloudflare TURN
  keys (named `telemedicine-test` at the providers), so a leak there never
  exposes live's keys; Paystack is always a **test** key (`sk_test_…`).
  Set with `firebase functions:secrets:set NAME --project test` (on
  Windows PowerShell: `firebase.cmd`), then redeploy the functions.
- **Accounts:** patients sign up on the test site. **Staff accounts are
  never created through the public sign-up page** (that makes a patient,
  which can never become staff): create the user in Firebase console →
  Authentication → Add user (password: 10+ characters with upper, lower,
  number and symbol, or the console only says "unknown error"), then
  `node scripts/staffAdmin.js make-admin email "Name"` (test by default;
  add `--project live` for live). Doctors: Add doctor in the test admin's Users tab.
- **Rules:**
  - Never put real patient data in the test project.
  - The GitHub environment `live` only deploys from `main` and `test`
    only from `test`; Google enforces the same (below). Never copy live
    values into the `test` environment.
  - Never give the test project a live (`sk_live_`) key, or live's own
    Brevo or Cloudflare keys.
- Paystack sends webhooks to one URL per mode, and until go-live the test
  keys point at live's `paystackWebhook`. Test-project payments are
  confirmed by the verify-by-reference check when the patient returns.
  Their references start `HFT-` (`PAYMENT_REF_PREFIX`), live's `HFH-`, so
  live ignores test payments instead of refunding them as strays. **At
  go-live**, set Paystack's *test* webhook URL to the test project's
  `paystackWebhook` (Paystack → Settings → API Keys & Webhooks).

Emails and reminders are only deployed when `functions/lib/mailConfig.js`
has a real sender address (it does now), and every function secret must
exist or the CLI refuses to deploy anything.

### Website deploys

The website is on **Firebase Hosting** (since 22 Oct 2026; Vercel before): live `telemedicine-hfch` at https://telemedicine.hfhberekum.org
(also `telemedicine-hfch.web.app`), test at
https://telemedicine-hfch-test.web.app. Headers (CSP, caching), the
page routing and the files served are in `firebase.json` → `hosting`.

`.github/workflows/deploy-website.yml` builds and publishes on every push
to `main` (live) and `test` (test), **only after the security pipeline
passes**: its first job runs `security-audit.yml` (TruffleHog, ESLint,
Semgrep, Snyk, GitGuardian), and if that fails nothing is published. No
key file exists anywhere:

- GitHub proves who it is to Google (**Workload Identity Federation**). In
  each project: pool `github`, provider `telemedicine-app`, which only
  accepts this repository (by its ID, `1409413191`, so a renamed or
  re-created repo can't use it), the matching branch
  (`refs/heads/main` for live, `refs/heads/test` for test) and the matching
  GitHub environment.
- It acts as service account `website-deployer@<project>`, which can only
  publish hosting (*Firebase Hosting Admin*, *Service Usage Viewer*).
- The **repository is public**: settings live in GitHub → Settings →
  Environments, `live` (deployment branches: `main` only) and `test`
  (`test` only). Variables: `VITE_FIREBASE_API_KEY`,
  `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
  `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`,
  `VITE_FIREBASE_APP_ID`, `VITE_PAYSTACK_PUBLIC_KEY`,
  `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`, `VITE_SITE_URL`,
  `VITE_CANONICAL_REDIRECT` (`live` only, `on`; see "The hospital
  domain"), `GCP_WORKLOAD_IDENTITY_PROVIDER`
  (`projects/<number>/locations/global/workloadIdentityPools/github/providers/telemedicine-app`;
  live `973381621706`, test `608175505205`) and
  `GCP_DEPLOY_SERVICE_ACCOUNT`. Secret: `VITE_STAFF_LOGIN_PATH`. Never set
  `VITE_APPCHECK_DEBUG_TOKEN` there. `VITE_SEARCH_INDEXING` isn't a
  variable: the workflow sets it from the branch (`on` for `main`, `off`
  for `test`).
- The workflow refuses to publish a build for the wrong project, without
  the staff path, or with Firebase in the first download.
- A site address is also listed in each project's reCAPTCHA key (App
  Check), the browser API key's allowed sites and Authentication →
  authorised domains. Adding a new address means all three.
- To roll back: Firebase console → Hosting → release history → *Rollback*
  on the previous release (instant), then fix and push.
- **Never from a computer:** `firebase.json` → `hosting.predeploy`
  (`scripts/hostingPredeploy.cjs`) refuses a hosting deploy outside GitHub
  Actions, so `firebase deploy --project live` typed by mistake can't
  publish a local build (test settings). Always name what you deploy:
  `--only functions`, `--only firestore,storage`.
- **Supply chain:** the job installs with `--ignore-scripts`, and the
  Firebase CLI comes from its own lockfile (`.github/firebase-cli`; to
  update: change the version in its `package.json`, run
  `npm install --package-lock-only --ignore-scripts` there, commit both).
  Actions are pinned to commit SHAs. The build is refused if it contains an
  App Check debug token, emulator addresses or source maps. The security
  pipeline gets only the Snyk and GitGuardian keys, and only the deploy job
  may ask Google for a token.
- **Who can deploy live = who can push to `main`.** Keep write access to
  the repository to the people who need it, require two-factor sign-in in
  the GitHub organisation, and protect `main` and `test` (Settings → Rules
  → Rulesets: block force pushes and deletion).

#### The hospital domain

`telemedicine.hfhberekum.org` moved from Vercel to Firebase Hosting on
22 Oct 2026 (Vercel was then deleted, its GitHub app removed). In
Cloudflare: `telemedicine` is a CNAME to `telemedicine-hfch.web.app`,
**DNS only** (grey cloud; the orange-cloud proxy stops Firebase renewing
the certificate), plus the TXT record `_acme-challenge.telemedicine`,
which Firebase uses to renew the certificate: keep both. The GitHub `live`
environment has `VITE_CANONICAL_REDIRECT` = `on`, so Firebase's own
addresses (`telemedicine-hfch.web.app`, `.firebaseapp.com`) send visitors
to the real one, and live's reCAPTCHA key and browser key accept only the
hospital domain (plus `firebaseapp.com` on the key, which Firebase sign-in
pages use).

If the domain ever changes: get the new certificate issued **before**
moving traffic (Firebase's `_acme-challenge` TXT record; the site sends
HSTS, so a missing certificate makes it unreachable, not just insecure);
add the new address to the reCAPTCHA key, the browser key and
Authentication → authorised domains; set `VITE_SITE_URL`; and remove the
old domain from the old host before deleting anything there, so nobody can
claim it.

### Staff app on a desktop

Open the staff sign-in page in Chrome or Edge and use **Install** (the icon
in the address bar, or menu → *Install Holy Family Staff*). The installed
"Holy Family Staff" app opens straight on the staff sign-in page. Patients'
installed app ("Holy Family") is separate and opens the patient dashboard.

## 5. Where things are

- **All routes:** `src/App.jsx`. **Auth state:** `src/context/authContext.jsx`
  (read its header first). **Route guards:** `src/protectedRoutes.jsx`.
- **Every deployed function:** `functions/index.js`. Auth checks,
  validation, audit and rate limits: `functions/lib/core.js`. Never import
  `onCall` from firebase-functions directly; use the one in `core.js`
  (it applies App Check).
- **The trickiest logic:**
  - Video-call waiting rule, no-shows, "doctor couldn't make it", closing a
    consultation: `functions/lib/consultationLifecycle.js` (header explains
    the rules), enforced by `functions/noShow.js` (every minute) and
    `functions/consultations.js` (`callHeartbeat`, `startVideoCall`).
  - Payments, drafts, refunds of unusable payments, reconciliation:
    `functions/payments.js`, `functions/reconcile.js`, `functions/refunds.js`,
    `functions/refundSync.js`.
  - Late reschedule fee: `functions/lateReschedule.js` (rules in
    `rescheduleNeedsLateFee`, `lib/consultationLifecycle.js`).
  - Prescriptions: `functions/prescriptions.js` (who may issue, when) and
    `functions/lib/prescriptionPdf.js` (the server-built PDF).
  - Real caller IP for limits and audit: `clientIp` in `functions/lib/core.js`
    (comment explains why it's the right-most `X-Forwarded-For` entry).
  - Deleting a patient: `functions/lib/accountDeletion.js`.
  - Video calls: `components/video/` (`useWebRTCCall.js` header explains
    the signalling protocol).
- **Background tasks:** written with `task()` (`functions/lib/task.js`) in
  `noShow.js`, `reminders.js`, `maintenance.js`, `reconcile.js`,
  `refundSync.js`, `recordings.js`, `email.js`; run by three scheduled jobs
  in `functions/jobs.js` (every minute / every 15 minutes / daily 02:00).
  A new task: give it one of the schedules jobs.js lists and add it to
  `TASKS` in `index.js`.
- **Patient pages:** `components/patient/`. Page files stay short and
  import their parts: the booking page's steps, cards and payment calls
  are in `booking/` with its checks in `bookingForm.js`; Home's sections in
  `home/`; the dashboard's fee rules in `dashboard/rescheduleRules.js` and
  grouping in `dashboard/patientUtils.js`. Logic worth testing goes in a
  plain `.js` file (tests in `components/patient/tests/`).
- **Email service:** `functions/lib/mailProvider.js` (Resend or Brevo,
  setting `MAIL_PROVIDER`).
- **Website errors:** `src/errorReporting.js` -> `functions/clientErrors.js`.
- **End-to-end tests:** `e2e/` (start with `e2e/helpers.mjs`).
- **Owner scripts** (`functions/scripts/`, run locally, never deployed):
  `staffAdmin.js` (make-admin, reset-mfa, issue-setup-code, sync-claims…),
  `resetTestPayments.js` (go-live only).

## 6. Known gaps (what I'd work on next)

1. **Test coverage:** the robot covers the patient's main journeys; not
   yet the admin and doctor screens themselves (their functions are
   covered), no-show fee payment, rescheduling and patient deletion.
   The manual [GO_LIVE_TEST_CHECKLIST.md](GO_LIVE_TEST_CHECKLIST.md)
   covers the rest, and the real Paystack window. `npm run test:patient`
   could be added to the *Build* workflow.
2. **Data retention** isn't automated (audit log, consultation history,
   recordings are kept until the hospital decides periods).
3. **Folder layout** (`src/` and `components/` importing each other) works
   but could be unified.
4. **Placeholders** to replace at launch: hospital phone and WhatsApp
   number in `components/shared/contact.js` and `functions/lib/mailConfig.js`.
5. **Dependabot:** three alerts in the deploy job's Firebase CLI lockfile
   (`braces`, `@opentelemetry/core` 1.x, `uuid` 9) have no non-breaking fix;
   they're denial-of-service only and not reached by a hosting deploy, so
   they were dismissed with reasons (23 Oct 2026). Recheck when the
   Firebase CLI is next updated.

## 7. Who decided what

Hospital decisions behind the rules (medical director and management) are
recorded where they apply, in code comments and CLAUDE.md, for example:
no doctor advertising, age instead of date of birth, two-admin recording
access, no fixed-cost services, browser-only screenshot deterrence, the
video-call waiting rule and refunds when a doctor can't make it. Don't
change them without the hospital.
