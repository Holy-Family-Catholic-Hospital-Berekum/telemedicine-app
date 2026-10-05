# Security operations guide

For whoever runs the hospital's telemedicine platform (Firebase project
`telemedicine-hfch`, site on Vercel). It covers what protects the platform,
the everyday procedures (new staff, lost phones, deleting recordings,
restoring data), and the few steps still to do.

All `node scripts/...` commands run from the `functions/` folder, on a
computer signed in to the Google Cloud CLI as a project Owner
(`gcloud auth login --update-adc`). That Google account must itself have
2-Step Verification on: it controls all patient data.

---

## What's switched on

| Protection | What it does | Where |
|---|---|---|
| Staff authenticator app | Admins and doctors sign in with password + authenticator code (Google/Microsoft Authenticator). Only the authenticator linked with a one-time **setup code** works. Fresh sign-in every 12 h. | Every function (`requireRole`), Firestore and Storage rules |
| Idle sign-out | Staff after 30 min, patients after 60 min. Never during a video call. | Website |
| Two-admin recording deletion | One admin requests, a *different* admin approves; nothing is deleted before that. Requests expire after 72 h. | `recordings.js` |
| Password policy | 10+ characters, upper and lower case, number, symbol. | Firebase Authentication |
| Sign-in reCAPTCHA (audit) | Every email/password sign-in and sign-up is scored by reCAPTCHA; nothing is blocked (see "Still to do"). | Firebase Authentication |
| Email enumeration protection | Sign-in doesn't reveal which emails have accounts. | Firebase Authentication |
| Rate limits | Per-account limits on every function that could be abused; forged payment webhooks are audited at most 10/hour per sender. | `lib/core.js rateLimit` |
| Backups | Point-in-time recovery (any minute, last 7 days) + daily backup kept 7 days + database delete protection. | Firestore |
| Tamper-proof audit copy | Every audit entry is copied to the `audit-locked` log bucket (365 days). | `mirrorAuditLog` → log sink `audit-to-locked` |
| Security alerts | Email to the security contact on: failed/refused staff sign-in steps, authenticator resets, screenshot attempts, forged payment webhooks, recording deletion requests and deletions, missing recordings. | Cloud Monitoring policy *Telemedicine security event* |
| Least-privilege functions | Functions run as `functions-runtime@…` with only the roles listed below. | `lib/core.js` |
| App Check | Requests carry proof they come from the real site (reCAPTCHA Enterprise). Monitoring now; enforce later (see "Still to do"). | Firestore, Storage, functions |
| API key restriction | The public web key only works from the hospital's sites. | Google Cloud credentials |
| Security headers | CSP, HSTS, no framing, etc. | `vercel.json` |
| Rule tests | `npm run test:rules` checks the access rules on the emulator. Run before every rules change. | `tests/rules/` |

---

## New staff

**New admin** (IT, with Owner access):
```
node scripts/staffAdmin.js make-admin someone@hospital.org "Full Name"
```
It prints a **setup code** (valid 72 hours). Give it to them **in person or
by phone, never by email or message**. They then:
1. Install Google or Microsoft Authenticator on a phone only they use, with
   the app's own lock (PIN/fingerprint) on.
2. Sign in on the staff page → scan the QR code → enter the app's code.
3. Sign in again with the app's code → enter the setup code.

The Audit tab then shows *"Registered an authenticator app for staff
sign-in"*.

**New doctor** (any admin): Admin dashboard → **Users** → **Add doctor**.
The doctor gets an email to set their password, and the admin sees the
doctor's **setup code** once, to hand over in person. The doctor follows
the same three steps.

**Existing doctor who hasn't set up yet, or whose code expired**: Users →
the doctor's row → **Setup code**.

Why the setup code: anyone who learns a password could register *their own*
authenticator with Firebase. Without the setup code it's never linked, so it
gives no access.

## Lost or replaced phone

First confirm it's really them: in person, or by calling a number you
already had. Never on the strength of an email alone.

- **Doctor**: Users → their row → **Reset authenticator**. They're signed
  out everywhere; give them the new setup code.
- **Admin**: `node scripts/staffAdmin.js reset-mfa admin@hospital.org`
  (prints the new setup code).

If a staff member signs in and is asked for an authenticator code they
never set up, someone else registered one with their password: reset it as
above **and** have them change their password.

## Deleting call recordings

Recordings tab → **Request deletion** (one recording, or everything older
than a date), with a reason. A **different** admin opens the Recordings tab,
reviews it under *Deletions waiting for approval* and approves (type DELETE)
or rejects. Both admins are recorded in the audit log, and the security
contact gets an email.

## Restoring data

Point-in-time recovery and daily backups restore to a **new** database,
which you then inspect or copy from. They never overwrite the live one.

- Backups: Google Cloud console → Firestore → **Disaster recovery**. List
  them with `gcloud firestore backups list --location=eur3`.
- Restore a backup:
  `gcloud firestore databases restore --source-backup=<backup name> --destination-database=restore-YYYYMMDD`
- Point in time: Firestore → Disaster recovery → **Point-in-time recovery**.

Backups hold booking details that were deleted from the live database for
up to 7 days (the privacy policy says so). Delete a restore database when
you're finished with it.

## Audit log and alerts

- The admin **Audit** tab shows the working copy.
- The tamper-proof copy: Google Cloud console → **Logging** → **Logs
  Explorer** → *Refine scope* → log bucket `audit-locked`. Its retention is
  locked: nobody can delete or shorten it, including project owners.
- Alert emails go to teslajunior0552@gmail.com. To add people: Monitoring →
  **Alerting** → *Telemedicine security event* → edit notification
  channels.

## Service accounts

Functions run as `functions-runtime@telemedicine-hfch.iam.gserviceaccount.com`
with only:
`roles/datastore.user`, `roles/storage.objectAdmin`, `roles/firebaseauth.admin`,
`roles/secretmanager.secretAccessor`, `roles/logging.logWriter`,
`roles/monitoring.metricWriter`, `roles/run.invoker`,
`roles/eventarc.eventReceiver`, and *Service Account Token Creator* on
itself (to sign 10-minute recording links).

Keep human Owners to the minimum (today: one), each with 2-Step
Verification. Don't give Editor or Owner to anyone who only needs the admin
dashboard. Their hospital admin account is enough.

---

## Still to do

1. **Enforce App Check** once the console shows nearly all traffic as
   verified (App Check → APIs → metrics):
   - Firestore → **Enforce**; Storage → **Enforce**.
   - Functions: `ENFORCE_APP_CHECK: true` in `functions/lib/securityConfig.js`,
     then `firebase deploy --only functions`.
   - Test patient booking, a call, doctor and admin sign-in. If anything
     breaks, unenforce while investigating.
2. **Custom domain** (when bought):
   - Add it in Vercel, then to: Firebase Authentication → *Authorized
     domains*; the reCAPTCHA key's allowed domains; the browser API key's
     website restrictions; `SITE_URL` in `functions/lib/mailConfig.js`.
   - Set up Resend for that domain (SPF, DKIM, DMARC records), set `FROM`
     and `REPLY_TO` in `mailConfig.js`, run
     `firebase functions:secrets:set RESEND_API_KEY`, and deploy functions.
     That switches on appointment emails and reminders.
3. **Sign-in reCAPTCHA stays in audit mode** (it scores sign-ins but
   blocks nothing). On 5 Oct 2026, enforce mode blocked a genuine admin
   sign-in, which showed up as "Invalid email or password", while a request
   with no reCAPTCHA token got through. Don't switch it to enforce on the
   live site. If you revisit it, test with a throwaway account and keep
   someone ready to run `node scripts/staffAdmin.js auth-recaptcha` (which
   sets audit) to undo it. Password guessing is still limited by Firebase's
   built-in throttling, the password policy and the staff authenticator.
4. **Replace the placeholders** in `components/shared/contact.js`: the
   hospital phone number and the WhatsApp support number.
5. **Paystack live keys** at go-live: the live secret key via
   `firebase functions:secrets:set PAYSTACK_SECRET_KEY`, the live public key
   in Vercel (`VITE_PAYSTACK_PUBLIC_KEY`), and the webhook URL in the
   Paystack dashboard.
