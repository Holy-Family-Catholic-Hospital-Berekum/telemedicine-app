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
| **Google Cloud / Firebase** project `telemedicine-hfch` | Back end, database, auth, logs, alerts, budget | IAM role *Owner* or *Editor* (Owner is needed for the staffAdmin script and IAM changes) |
| **Google Cloud billing** account (Firebase Payment) | Pays for Firebase; budget alerts | *Billing account viewer* at least |
| **Vercel** project | Old website host, kept as a fallback until about 28 Oct 2026, then deleted | Team member |
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
   `firebase use` should show `telemedicine-hfch`.
4. Create `.env` from `.env.example` (values from Firebase console, the
   GitHub `test` environment and the hospital; the staff path from the
   hospital).
5. **App Check:** it's enforced on the live project, so local development
   needs a debug token: Firebase console → App Check → Apps → web app →
   *Manage debug tokens* → add one, put it in `.env` as
   `VITE_APPCHECK_DEBUG_TOKEN`. Delete it when you stop developing.
6. `npm run dev` → http://localhost:5173.

**Important: there is no separate test project.** Local development talks
to the **live** Firebase project (live database, live emails). Use test
accounts, never real patients' data, and be careful with anything that
writes. A separate test Firebase project is a worthwhile improvement
(see section 6).

## 3. Making a change

1. Branch or work on `main` (one developer: direct pushes are allowed;
   force-pushes and deleting `main` are blocked).
2. `npm run lint` and `npm run build` must pass. The pre-commit hook runs
   a secret scan and lint on staged files. If TruffleHog blocks a commit
   but lists no finding, it's a known glitch: just commit again.
3. Tests (GitHub runs all of them on every push to `main` or `test`):
   - `cd functions && npm test`: server unit tests (waiting rule, refund
     amounts, age, reminders, metrics report, scheduled jobs, email
     services, error scrubbing). No setup.
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
  password protection; on Vercel it was team-only): it's kept out of search
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

The website is on **Firebase Hosting** (since Oct 2026; before that,
Vercel): live `telemedicine-hfch` at https://telemedicine.hfhberekum.org
(also `telemedicine-hfch.web.app`), test at
https://telemedicine-hfch-test.web.app. Headers (CSP, caching), the
page routing and the files served are in `firebase.json` → `hosting`.

`.github/workflows/deploy-website.yml` builds and publishes on every push
to `main` (live) and `test` (test). No key file exists anywhere:

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
  `GCP_WORKLOAD_IDENTITY_PROVIDER`
  (`projects/<number>/locations/global/workloadIdentityPools/github/providers/telemedicine-app`;
  live `973381621706`, test `608175505205`) and
  `GCP_DEPLOY_SERVICE_ACCOUNT`. Secret: `VITE_STAFF_LOGIN_PATH`. Never set
  `VITE_APPCHECK_DEBUG_TOKEN` there.
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
  App Check debug token, emulator addresses or source maps.
- **Who can deploy live = who can push to `main`.** Keep write access to
  the repository to the people who need it, require two-factor sign-in in
  the GitHub organisation, and protect `main` and `test` (Settings → Rules
  → Rulesets: block force pushes and deletion).

#### Switching the domain to Firebase (once)

1. Check the live build at https://telemedicine-hfch.web.app (sign in as a
   patient and as staff, book, pay with a Paystack test card if still on
   test keys).
2. Firebase console (live) → Hosting → **Add custom domain** →
   `telemedicine.hfhberekum.org`, and choose the setup that issues the
   certificate **before** traffic moves (an `_acme-challenge` record).
   The site sends HSTS, so browsers that have visited refuse to open it at
   all while a certificate is missing: getting the certificate first
   avoids an outage.
3. In Cloudflare, replace the Vercel record (`CNAME …vercel-dns…`) with
   Firebase's records, **DNS only** (grey cloud). Keep Firebase's
   ownership TXT record.
4. When https://telemedicine.hfhberekum.org serves the Firebase version
   (Hosting shows the domain *Connected*): in GitHub environment `live` add
   the variable `VITE_CANONICAL_REDIRECT` = `on` and re-run *Deploy
   website*, so the `web.app` / `firebaseapp.com` addresses send visitors
   to the real one (`src/canonicalHost.js`). Then remove
   `telemedicine-hfch.web.app` from live's reCAPTCHA key (App Check) and
   browser API key, so a copy of the site there can't use the back end.

#### Retiring Vercel (about a week later), in this order

1. Confirm no DNS record in Cloudflare still points at Vercel
   (`vercel-dns`, `76.76.21.21`, `cname.vercel-dns.com`).
2. Vercel → project → Settings → Domains: remove
   `telemedicine.hfhberekum.org`. (Deleting the project while DNS still
   pointed there would let anyone claim the domain on Vercel.)
3. Delete the Vercel project (its environment variables, including the
   staff paths, go with it).
4. GitHub organisation → Settings → GitHub Apps: uninstall **Vercel**, so
   it no longer has access to the repository. Delete the GitHub
   environments `Preview` and `Production` it created.
5. Remove the Vercel addresses from both projects' reCAPTCHA keys,
   browser API keys and (test) Authentication authorised domains, delete
   `vercel.json`, and remove the Vercel fallback from `vite.config.js`
   (`VERCEL_GIT_COMMIT_SHA`).

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
  - Deleting a patient: `functions/lib/accountDeletion.js`.
  - Video calls: `components/video/` (`useWebRTCCall.js` header explains
    the signalling protocol).
- **Background tasks:** written with `task()` (`functions/lib/task.js`) in
  `noShow.js`, `reminders.js`, `maintenance.js`, `reconcile.js`,
  `refundSync.js`, `recordings.js`, `email.js`; run by three scheduled jobs
  in `functions/jobs.js` (every minute / every 15 minutes / daily 02:00).
  A new task: give it one of the schedules jobs.js lists and add it to
  `TASKS` in `index.js`.
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
   covers the rest, and the real Paystack window.
2. **Data retention** isn't automated (audit log, consultation history,
   recordings are kept until the hospital decides periods).
3. **Folder layout** (`src/` and `components/` importing each other) works
   but could be unified.
4. **Placeholders** to replace at launch: hospital phone and WhatsApp
   number in `components/shared/contact.js` and `functions/lib/mailConfig.js`.

## 7. Who decided what

Hospital decisions behind the rules (medical director and management) are
recorded where they apply, in code comments and CLAUDE.md, for example:
no doctor advertising, age instead of date of birth, two-admin recording
access, no fixed-cost services, browser-only screenshot deterrence, the
video-call waiting rule and refunds when a doctor can't make it. Don't
change them without the hospital.
