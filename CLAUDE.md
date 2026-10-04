# CLAUDE.md

Telemedicine web app for a hospital in Ghana (GHS currency, Paystack payments). Patients book and pay for consultations (General OPD or Surgical, online or in-person); doctors run video calls; admins assign bookings, manage users, prices, site images, legal text and call recording.

## Stack & commands

- React 19 + Vite 8 + React Router 7, Tailwind v4 (via `@tailwindcss/vite`, imported in `src/index.css`) plus plain per-area CSS files (`admin.css`, `auth.css`, …). Plain JS/JSX, no TypeScript, no test suite.
- Firebase (Blaze): Auth, Firestore (`eur3`), Storage, Cloud Functions v2 (Node 24, CommonJS, all in `europe-west1`) in `functions/`.
- Hosted on Vercel as an SPA (`vercel.json` rewrites everything to `index.html`).

```
npm run dev       # vite dev server
npm run build     # production build -> dist/
npm run lint      # eslint . (root config also lints functions/)
npm run preview
firebase deploy --only firestore,storage,functions
```

Husky pre-commit runs a trufflehog secret scan, then `lint-staged` → `eslint --fix` on staged `*.{js,jsx}`. ESLint includes `eslint-plugin-security`; `functions/**` uses Node globals, CommonJS, and double quotes.

Firebase config: `firebase.json`, `.firebaserc` (project `telemedicine-hfch`), `firestore.rules`, `storage.rules`, `firestore.indexes.json`. `functions/scripts/staffAdmin.js` is run locally (never deployed) to create admins (`make-admin`) and backfill role claims (`sync-claims`).

## Environment (`.env`, not committed)

`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_PAYSTACK_PUBLIC_KEY`, and `VITE_STAFF_LOGIN_PATH`. The staff sign-in route is registered only if `VITE_STAFF_LOGIN_PATH` is set (`src/staffRoute.js`); there's deliberately no default path, and the hidden URL should never be hard-coded or linked from public pages.

Function secrets (via `firebase functions:secrets:set`): `PAYSTACK_SECRET_KEY` (test key until go-live), `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN`.

## Layout

The code is split across two top-level folders. Both import from each other with relative paths (`../../src/firebase`).

- `src/` holds the app shell: `index.jsx` and `App.jsx` (all routes); `firebase.js` (exports `app`, `db`, `auth`, `functions` (europe-west1) and `storage` — never call `getFunctions`/`getStorage` elsewhere); `constants.js` (enum labels, `toDate`, Africa/Accra formatting, `callableMessage`); `consentText.js` (versioned booking consent — must match `functions/lib/consentText.js`); `doctorDirectory.js` (live listed `doctorProfiles`); `context/authContext.jsx`; `protectedRoutes.jsx`; auth pages; `siteSettings.js`; `legalDocs.js`.
- `components/` holds the feature areas:
  - `patient/`: `Home.jsx` (public landing), `bookConsultation.jsx` (booking + Paystack), `dashboard/` (bookings, open slots, join call, reschedule, history; `patientFirestoreService.js`).
  - `doctor/`: `doctor.jsx` dashboard, `docFirestoreService.js`, profile tab, `ui/`.
  - `admin/`: `admin.jsx` shell with tabs (overview, bookings, history, users, call recordings, revenue, audit, metrics, control panel incl. `recordingSwitchCard.jsx`). `hooks/useFirestoreCollection.js` converts top-level Timestamps to Dates.
  - `video/`: WebRTC. `useWebRTCCall.js` imports signalling **only** through `signaling.js` → `signaling.firebase.js` (`calls/{consultationId}`, created by `startVideoCall`). `callRecording.js` records in the doctor's browser, but the server decides whether to record; it uploads 30 s segments that `finalizeRecording` stitches and hashes. TURN via `getTurnCredentials` (participants only).
  - `shared/`: header, footer, `brandAside`, contact info.
- `functions/`: `index.js` lists every deployed function by name (nothing else deploys). `lib/core.js` has the region, `requireRole`, validators, `audit()`, `rateLimit()`. Modules: `accounts`, `payments`, `scheduling`, `consultations`, `recordings`, `maintenance` (scheduled jobs), `siteSettings`, `legalDocs`.

Filenames are mostly camelCase (`bookConsultation.jsx`), with a few PascalCase (`Home.jsx`). Firestore fields are camelCase.

## Routing & auth

Routes in `src/App.jsx`: public `/`, `/privacy`, `/terms`; `PublicOnlyRoute` for `/signin`, `/signup` and the staff path; `/verify-email`, `/unauthorized`; patient (verified email) `/dashboard`, `/book`; `/admin`; `/doctor`.

`authContext.jsx` is the single source of auth state (`useAuth()`). Read its header comment before changing auth.
- **Role comes from the `role` custom claim**, set only by functions (`registerPatient`, `createDoctorAccount`) and the `staffAdmin` script. The profile doc (`adminUsers/{uid}` for staff, `users/{uid}` for patients) must be `active`. No claim = no access; there is no patient fallback. `ProtectedRoute` fails closed on a null role.
- `signIn()` takes `audience: "patient" | "staff"`; an account on the wrong page gets the same generic error as a wrong password. Sign-up creates the Auth user then calls `registerPatient` (deletes the Auth user if that fails).
- Persistence is session-only by default; "Remember me" (patients only) switches to local. Idle timeout 15 min staff / 30 min patients.
- Staff MFA (TOTP via Identity Platform) is deferred — search `MFA HOOK` in authContext, `functions/lib/core.js` and `firestore.rules`.

## Security model (keep this intact)

- The browser is untrusted. Every write to bookings, consultations, payments, history, recordings, consents and the audit log is a Cloud Function (`requireRole` checks claim + active profile, inputs validated, rate-limited where abusable). Rules deny client writes except a doctor's own presentational `doctorProfiles` fields and call signalling (doctor writes `offer`, patient writes `answer`).
- Fees are computed on the server (`loadPrices()`, falling back to `DEFAULT_FEES`); no specialist surcharge. Keep `DEFAULT_PRICES` (`src/siteSettings.js`) and `DEFAULT_FEES` (`functions/siteSettings.js`) in sync. Payment is confirmed only by the signed Paystack webhook or verify-by-reference, idempotently. Amounts are whole GHS; ×100 happens only in `paymentIsAcceptable()` and when opening the popup.
- **Data retention (hospital decision):** booking details (DOB, sex, location, phone) live on `bookings` and `consultations.patientDetails` and are deleted by `markConsultationDone`; unpaid drafts are deleted after 24 h. Kept: `consultationHistory` (doctor, times, outcome, amount — patients see their own), `confirmedPayments`, `consents`, `auditLog`, `recordings`.
- **Call recording:** controlled only by the admin switch `systemSettings/features.callRecordingEnabled` (`setCallRecordingEnabled`), snapshotted per call in `calls.recordingEnabled`; both sides see REC from `calls.recordingActive`. Recordings carry patient/doctor names and a SHA-256. Admins play/download via 10-minute signed URLs with a reason, and delete singly or by date. All audited. No client can read the files.
- Consent: booking consent text is versioned; the server stores version + text hash + IP + time in `consents`. Never edit a published version — add a new one in both `consentText.js` files.

## Firestore collections

`users`, `adminUsers` (admins and doctors), `doctorProfiles` (public), `bookings` (`awaiting_payment` → `paid` → `scheduled`), `consultations` (`scheduled` | `in_progress`; ID `HFC-` + 10 chars), `consultationHistory`, `availableSlots` (`open`/`held`/`booked`/`cancelled`, `startAt`), `confirmedPayments`, `paymentRefs`, `consents`, `auditLog`, `calls`, `recordings`, `rateLimits`, `siteSettings/public`, `legalDocs/{terms|privacy}`, `systemSettings/features`. Enums: type `OPD`|`SURGICAL`, mode `online`|`in_person`, outcome `completed`|`no_show` (`src/constants.js` ↔ `functions/lib/core.js`).

## Current state / gotchas

- Appointment emails: scheduling writes `mail/{id}` (outbox, `lib/mailQueue.js`); `functions/email.js` sends via Resend. The email functions (and the `RESEND_API_KEY` secret) are only loaded when `lib/mailConfig.js` FROM isn't `@example.com` — the CLI refuses to deploy anything if a declared secret is missing. `bookings.lastEmail.status` shows admins whether the patient was emailed.
- New bookings are refused while any earlier payment attempt is unconfirmed (`checkAttempts(..., { strict: true })`). Patients consent once per consultation before their first video join (`consents` type `video_consultation`, versioned in both `consentText.js` files). Refund requests (`refundRequests/{consultationId}`) are allowed only after the appointment day and resolved manually by admins.
- Idle sign-out is 60 minutes for every role; staff routes redirect to `STAFF_LOGIN_PATH`. The video room opens 30 minutes before (`CALL_UNLOCK_MINUTES` ↔ `JOIN_OPENS_MINUTES_BEFORE`).
- Times are hospital time (Africa/Accra = UTC+0). The scheduling modal sends the `datetime-local` value with `Z`; slot times are UTC.
- Signed URLs need the functions service account to hold "Service Account Token Creator" on itself; Storage rules use cross-service Firestore reads (accept the console prompt on first deploy).
- Not done yet: staff MFA, App Check, CSP/security headers, backups/PITR, emulator tests for rules.
- `src/siteSettings.js` and `src/legalDocs.js` fall back to bundled defaults (images in `src/assets`/`images/`, legal text in `components/admin/legalDefaults.js`) so public pages render before Firestore responds. Keep that fallback.
- Code comments may refer to an "architecture doc" by section number; it isn't in the repo.
