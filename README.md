# Holy Family Catholic Hospital — Telemedicine

The online consultation service of Holy Family Catholic Hospital, Berekum
(Ghana), live at **https://telemedicine.hfhberekum.org**.

Patients book and pay (mobile money, through Paystack) for a General OPD or
Surgical consultation, either by **video call** or **at the hospital**.
Admins assign each booking a doctor and a time; doctors hold video
consultations from the hospital's telemedicine room; everyone is emailed
along the way. The hospital controls prices, no-show rules, call recording,
site images and the legal text from an admin portal.

> Developer taking over? Start with **[HANDOVER.md](HANDOVER.md)** (setup,
> access, deploying), then **[SECURITY_SETUP.md](SECURITY_SETUP.md)** (how
> the live system is run). **[CLAUDE.md](CLAUDE.md)** is the detailed
> reference for every rule and gotcha.

## Who uses it

| | Where | What they do |
|---|---|---|
| **Patients** | `/` , `/book`, `/dashboard` | Sign up (adults only; children are booked by a parent), book and pay, join video calls, reschedule, ask for refunds. Installable on a phone ("Holy Family"). |
| **Doctors** | `/doctor` (staff sign-in) | See their schedule and the patient's clinical details, start video calls from a registered room computer, write prescriptions after a video call (signed PDF the patient downloads for 7 days), close consultations, report "I can't make it". |
| **Pharmacists** | `/check-prescription` (no sign-in) | Scan a prescription's QR code to see whether it's valid, expired or cancelled. |
| **Admins** | `/admin` (staff sign-in) | Schedule bookings, manage users, prices, refunds, recordings, the audit log, metrics and the control panel. |

Staff sign in on a hidden page (its address is set by `VITE_STAFF_LOGIN_PATH`,
never written in the code) with a password **and** an authenticator app.

## How it fits together

```
 Patient phone / staff computer
        │  (website, installable app)
        ▼
 Firebase Hosting ── serves the React website (static files only)
        │
        ▼
 Firebase (Google Cloud, Europe)
   • Authentication  – accounts, staff authenticator codes
   • Firestore       – the database (bookings, consultations, history…)
   • Cloud Functions – every change happens here, never in the browser
   • Storage         – call recordings, doctor photos
   • App Check       – only the real website may call the above
        │
        ├── Paystack ── mobile money payments and refunds
        ├── Brevo ───── appointment emails (appointments@mail.hfhberekum.org)
        └── Cloudflare ─ relays video calls when a direct connection fails
```

Video calls are peer-to-peer (WebRTC) between the patient and the doctor's
room computer; Firebase only carries the connection set-up.

**The browser is never trusted.** Bookings, payments, consultations,
refunds, recordings and the audit log are written only by Cloud Functions,
which check the user's role, validate input and rate-limit. Database rules
let the browser read only what each person may see.

## Stack

| Part | Technology |
|---|---|
| Website | React 19, Vite 8, React Router 7, Tailwind CSS v4 (plain JavaScript, no TypeScript) |
| Installable app / offline | vite-plugin-pwa (service worker), self-hosted fonts |
| Back end | Firebase: Authentication (Identity Platform + TOTP), Firestore (`eur3`), Cloud Functions v2 (Node 24, `europe-west1`), Storage, App Check (reCAPTCHA Enterprise) |
| Payments | Paystack (mobile money), webhook + daily reconciliation |
| Email | Brevo (verified domain `mail.hfhberekum.org`; Resend also supported, `MAIL_PROVIDER`) |
| Video | WebRTC; Cloudflare TURN relay |
| Hosting | Firebase Hosting (website, published only by GitHub Actions), Firebase (back end); a separate test project and site |
| Quality / security | ESLint (+ security plugin), Husky pre-commit (TruffleHog secret scan, lint), GitHub Actions (TruffleHog, ESLint, Semgrep, Snyk, GitGuardian, which must pass before the website is published; unit, rules, emulator and end-to-end tests) |

## Folders

```
src/                 App shell: routes (App.jsx), Firebase setup, auth,
                     shared helpers (dates, consent text, site settings),
                     sign-in / sign-up pages.
components/
  patient/           Home page (sections in home/), booking page (steps in
                     booking/), patient dashboard, and their tests.
  doctor/            Doctor portal.
  admin/             Admin portal (one file per tab).
  video/             Video calls (WebRTC, call screen, recording).
  shared/            Header, footer, pagination, offline/slow banners…
functions/           Cloud Functions (the back end).
  index.js           The list of every deployed function.
  lib/               Shared rules: core.js (auth checks, validation,
                     audit, rate limits), consultationLifecycle.js
                     (no-shows, closing), emails, Paystack, deletion.
  scripts/           Owner-only scripts run on a laptop, never deployed
                     (making admins, resetting authenticators, go-live).
tests/rules/         Database/storage rules tests (emulators).
e2e/                 End-to-end robot tests (Playwright, emulators).
firestore.rules      Who may read what (database).
storage.rules        Who may read what (files).
firebase.json        Firebase settings, incl. website headers (security policy) and routing.
```

Why both `src/` and `components/`: the project started as separate pieces
that were later joined; they import from each other with relative paths.
It works fine; moving everything into one folder is optional tidying.

## Commands

```bash
npm install            # once
npm run dev            # local website at http://localhost:5173
npm run build          # production build into dist/
npm run lint           # ESLint for the website and functions
npm run test:rules     # rules tests on the Firebase emulators (Java 21)
npm run test:functions # server tests on the emulators (Java 21)
npm run test:e2e       # end-to-end robot tests on the emulators (Java 21)
npm run test:patient   # patient-page logic: booking form, reschedule fees (no setup)
cd functions && npm test   # server unit tests (no setup)
npm run deploy:functions   # deploy only changed functions (test; add -- --project live)

cd functions && npm install
# Firebase commands go to the TEST project unless you add --project live
firebase deploy --only functions --project live           # back end
firebase deploy --only firestore,storage --project live   # rules and indexes
```

The website deploys itself: every push to `main` on GitHub is built and
published to Firebase Hosting by GitHub Actions once the security checks
pass (`test` goes to the test site,
https://telemedicine-hfch-test.web.app). It can't be deployed from a
computer. See [HANDOVER.md](HANDOVER.md) for the details and the
deployment quirks.

## Documentation

| File | For | What's in it |
|---|---|---|
| [HANDOVER.md](HANDOVER.md) | A developer taking over | Access to hand over, first-time setup, deploying, where everything lives |
| [SECURITY_SETUP.md](SECURITY_SETUP.md) | Whoever runs the live system | Staff accounts, lost phones, restores, alerts, budget, payments go-live |
| [GO_LIVE_TEST_CHECKLIST.md](GO_LIVE_TEST_CHECKLIST.md) | Testers | The full manual test pass before launch and after big changes |
| [CLAUDE.md](CLAUDE.md) | Developers (and AI assistants) | Detailed reference: every rule, collection and gotcha |
| `.env.example` | Developers | The website's settings, without values |

## Ownership

Copyright © 2026 Holy Family Catholic Hospital, Berekum. All rights
reserved; see [LICENSE](LICENSE). The source is published for transparency
only.
