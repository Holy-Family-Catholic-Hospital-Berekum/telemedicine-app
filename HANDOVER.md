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
| **Vercel** project | Hosts the website, environment variables | Team member |
| **Paystack** dashboard | Payments, refunds, webhook URL, API keys | Developer role |
| **Resend** | Emails; API key | Team member |
| **Cloudflare** account `hfhberekum.org` | DNS (website, email records), TURN video relay key | Member with DNS + Calls/TURN access |
| **Snyk, GitGuardian** | Security scans used by CI (tokens stored as GitHub secrets) | Optional |
| A **staff test account** on the live site | Testing the portals | An admin creates it; needs an authenticator app |

Secrets never live in the repo:

| Secret | Where it lives | Set with |
|---|---|---|
| Paystack secret key | Firebase function secret `PAYSTACK_SECRET_KEY` | `firebase functions:secrets:set PAYSTACK_SECRET_KEY` |
| Resend API key | Firebase function secret `RESEND_API_KEY` | `firebase functions:secrets:set RESEND_API_KEY` |
| Cloudflare TURN | Function secrets `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN` | same command |
| Website settings | `.env` locally, Vercel env vars live | see `.env.example` |
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
4. Create `.env` from `.env.example` (values from Firebase console, Vercel
   and the hospital; the staff path from the hospital).
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
3. Changing database or storage rules: add a test in
   `tests/rules/rules.test.mjs`; GitHub runs them on every push that
   touches the rules (*Security rules tests* workflow).
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
| Website | `git push` to `main` | Vercel builds and publishes in ~1 minute. A broken `vercel.json` fails the whole deploy silently: check the commit's status on GitHub. |
| Functions | `FUNCTIONS_DISCOVERY_TIMEOUT=60 firebase deploy --only functions` | The timeout variable avoids a load timeout on slow machines. A change that raises the minimum bill (e.g. `minInstances`) needs `--force`. |
| Database / storage rules | `firebase deploy --only firestore:rules,storage` | Rules are live immediately. |
| Indexes | `firebase deploy --only firestore:indexes` | Deploy new indexes **before** functions that need them and wait until they show READY (`gcloud firestore indexes composite list`), or the queries fail meanwhile. |

After deploying functions, watch Cloud Logging for errors for a few
minutes; the *Telemedicine function errors* alert emails the owner too.

Emails and reminders are only deployed when `functions/lib/mailConfig.js`
has a real sender address (it does now), and every function secret must
exist or the CLI refuses to deploy anything.

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
- **Scheduled jobs:** `noShow.js`, `reminders.js`, `maintenance.js`,
  `reconcile.js`, `refundSync.js`, `recordings.js`.
- **Owner scripts** (`functions/scripts/`, run locally, never deployed):
  `staffAdmin.js` (make-admin, reset-mfa, issue-setup-code, sync-claims…),
  `resetTestPayments.js` (go-live only).

## 6. Known gaps (what I'd work on next)

1. **No automated tests for the server logic.** The waiting rule,
   no-show/refund amounts, age checks and deletion are only covered by the
   manual [GO_LIVE_TEST_CHECKLIST.md](GO_LIVE_TEST_CHECKLIST.md). Unit tests
   for `consultationLifecycle.js` (`waitDeadline`, `rescheduleCountsAsNoShow`)
   and the money maths would be the most valuable addition.
2. **No separate test environment.** Development uses the live project.
   A second Firebase project (`telemedicine-hfch-test`) with its own
   Paystack test keys would make changes much safer.
3. **Data retention** isn't automated (audit log, consultation history,
   recordings are kept until the hospital decides periods).
4. **Folder layout** (`src/` and `components/` importing each other) works
   but could be unified.
5. **Placeholders** to replace at launch: hospital phone and WhatsApp
   number in `components/shared/contact.js` and `functions/lib/mailConfig.js`.

## 7. Who decided what

Hospital decisions behind the rules (medical director and management) are
recorded where they apply, in code comments and CLAUDE.md, for example:
no doctor advertising, age instead of date of birth, two-admin recording
access, no fixed-cost services, browser-only screenshot deterrence, the
video-call waiting rule and refunds when a doctor can't make it. Don't
change them without the hospital.
