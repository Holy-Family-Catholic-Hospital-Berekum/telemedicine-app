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
  - `patient/`: `Home.jsx` (public landing, incl. open appointment slots under "Meet your doctors"), `bookConsultation.jsx` (booking + Paystack; "Myself" / "My child (under 18)"), `dashboard/` (tabs "My appointments" — bookings grouped Scheduled / Waiting to be scheduled / Payment not confirmed, open slots, history — and "Settings" (`patientSettings.jsx`: name, email); `patientFirestoreService.js`).
  - Patient pages are wrapped in `.patient-ui` (`PatientPage` in `App.jsx`), which raises Tailwind's `text-xs/sm/base` sizes (`src/index.css`) for readers of all ages. Keep patient text ≥14px and dark (`#3E4E56`, `black/70+`); staff pages keep defaults.
  - `doctor/`: `doctor.jsx` dashboard, `docFirestoreService.js`, profile tab, `ui/`.
  - `admin/`: `admin.jsx` shell with tabs (overview, bookings, history, users, call recordings, revenue, audit, metrics, control panel incl. `recordingSwitchCard.jsx`). `hooks/useFirestoreCollection.js` converts top-level Timestamps to Dates.
  - `video/`: WebRTC. `videoCallModal.jsx` shows the other person's whole picture, uncropped, on a blue background (a phone shows portrait on the room TV; the TV camera shows landscape on the phone). Hospital decision: no zoom/fill. `useWebRTCCall.js` imports signalling **only** through `signaling.js` → `signaling.firebase.js` (`calls/{consultationId}`, created by `startVideoCall`). `callRecording.js` records in the doctor's browser, but the server decides whether to record; it uploads 30 s segments that `finalizeRecording` stitches and hashes. TURN via `getTurnCredentials` (participants only).
  - `shared/`: header, footer, `brandAside`, contact info.
- `functions/`: `index.js` lists every deployed function by name (nothing else deploys). `lib/core.js` has the region, `requireRole`, validators, `audit()`, `rateLimit()`. Modules: `accounts`, `payments`, `scheduling`, `consultations`, `recordings`, `refunds`, `roomDevices`, `maintenance` (scheduled jobs), `siteSettings`, `legalDocs`, plus `email` and `reminders` (only deployed once email is configured).

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

`users`, `adminUsers` (admins and doctors), `doctorProfiles` (public), `roomDevices` (admin read; key hashes only), `mail` (outbox, no client access), `refundRequests`, `bookings` (`awaiting_payment` → `paid` → `scheduled`), `consultations` (`scheduled` | `in_progress`; ID `HFC-` + 10 chars), `consultationHistory`, `availableSlots` (`open`/`held`/`booked`/`cancelled`, `startAt`; open ones are publicly readable), `confirmedPayments`, `paymentRefs`, `consents`, `auditLog`, `calls`, `recordings`, `rateLimits`, `siteSettings/public`, `legalDocs/{terms|privacy}`, `systemSettings/features`. Enums: type `OPD`|`SURGICAL`, mode `online`|`in_person`, outcome `completed`|`no_show` (`src/constants.js` ↔ `functions/lib/core.js`).

## Current state / gotchas

- Emails go to patients AND doctors through the `mail/{id}` outbox (`queueEmail` in `lib/mailQueue.js`, templates in `lib/emailTemplates.js`; doctor emails never include the patient's name or the consultation ID). Scheduling queues scheduled/rescheduled (patient) and assigned/rescheduled/unassigned (doctor). `reminders.js` (`sendAppointmentReminders`, every 5 min) sends 24 h and 1 h reminders to both, and a "not joined yet" email 5 min after an online start to whichever side hasn't joined, tracked in `consultations.reminders.*` (cleared on reschedule). `functions/email.js` sends via Resend and drops mail past `data.sendBefore`. The email and reminder functions (and the `RESEND_API_KEY` secret) are only loaded when `lib/mailConfig.js` FROM isn't `@example.com`; the CLI refuses to deploy anything if a declared secret is missing. `bookings.lastEmail.status` shows admins whether the patient was emailed.
- Doctors start/rejoin calls only from a registered telemedicine room computer: an admin registers it in Control panel (`registerRoomDevice`), its browser keeps `{id, key}` in localStorage (`src/roomDevice.js`), and `startVideoCall` requires an active key for doctors (`verifyRoomDevice`). Doctors never see the consultation ID. Patients join and request reschedules with one click (server checks they are the booked, verified patient); the ID is only a reference shown on their booking card and in emails.
- `startVideoCall` records who joined (`consultations.patientFirstJoinedAt`/`doctorFirstJoinedAt`, copied to `bookings.patientJoinedAt`/`doctorJoinedAt`, and `patientJoined`/`doctorJoined` on history). A consultation both sides joined can't be rescheduled; one that either side missed can (the reschedule resets the join fields, reminders and the `calls` doc).
- Refunds (`refundRequests/{consultationId}`, resolved manually by admins) only for a scheduled consultation the patient never joined (or closed as no-show without them joining), after the appointment day, and not alongside a reschedule. The patient dashboard puts "Reschedule appointment" first and the refund as a small link.
- Age (Ghana DPA, Act 843): sign-up requires an adult declaration (`ageDeclarationVersion`, consent type `age_declaration`). A booking is for the account holder (must be 18+ by the DOB given) or for their child under 18 (`forChild`, `childName`, guardian consent type `guardian_consent`); then `bookings.patientName` is the child and `guardianName` the account holder, who is the one emailed. Texts versioned in both `consentText.js` files.
- Patient settings: `updatePatientProfile` (name); email changes via `verifyBeforeUpdateEmail` after re-auth (`requestEmailChange` in authContext), then authContext calls `syncAccountEmail` to copy the verified address to `users` and open bookings.
- Screen capture can't be blocked in a browser. The call screen deters it: a watermark with the viewer's name and time over the remote video, right-click/PiP/drag off, and screenshot/recording shortcuts it can see show a warning and are audited (`reportCaptureAttempt`, `consultation.capture_attempt`). The hospital recording draws the raw video, so it has no watermark.
- New bookings are refused while any earlier payment attempt is unconfirmed (`checkAttempts(..., { strict: true })`). Patients consent once per consultation before their first video join (`consents` type `video_consultation`, versioned in both `consentText.js` files).
- Terms/privacy built-in text (`components/admin/legalDefaults.js`) is edited in place while pre-launch (stays "version 1"); keep the terms in step with refund/reschedule/email behaviour.
- Idle sign-out is 60 minutes for every role; staff routes redirect to `STAFF_LOGIN_PATH`. The video room opens 30 minutes before (`CALL_UNLOCK_MINUTES` ↔ `JOIN_OPENS_MINUTES_BEFORE`).
- Times are hospital time (Africa/Accra = UTC+0). The scheduling modal sends the `datetime-local` value with `Z`; slot times are UTC.
- Signed URLs need the functions service account to hold "Service Account Token Creator" on itself; Storage rules use cross-service Firestore reads (accept the console prompt on first deploy).
- Not done yet: staff MFA, App Check, CSP/security headers, backups/PITR, emulator tests for rules.
- `src/siteSettings.js` and `src/legalDocs.js` fall back to bundled defaults (images in `src/assets`/`images/`, legal text in `components/admin/legalDefaults.js`) so public pages render before Firestore responds. Keep that fallback.
- Code comments may refer to an "architecture doc" by section number; it isn't in the repo.
