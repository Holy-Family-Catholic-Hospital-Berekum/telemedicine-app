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
| Idle sign-out | Staff after 30 min, patients after 60 min. Never during a video call. Staff also on the server: no activity for 35 min = refused. | Website; `requireRole`, both rules files |
| Two-admin recording access and deletion | Playing, downloading or deleting a recording: one admin requests, a *different* admin approves. Requests expire after 72 h. **Needs at least two admins.** | `recordings.js` |
| Password policy | 10+ characters, upper and lower case, number, symbol. | Firebase Authentication |
| Sign-in reCAPTCHA (audit) | Every email/password sign-in and sign-up is scored by reCAPTCHA; nothing is blocked (see "Still to do"). | Firebase Authentication |
| Email enumeration protection | Sign-in doesn't reveal which emails have accounts. | Firebase Authentication |
| Rate limits | Per-account limits on every function that could be abused; forged payment webhooks are audited at most 10/hour per sender. | `lib/core.js rateLimit` |
| Backups | Point-in-time recovery (any minute, last 7 days) + daily backup kept 7 days + database delete protection. | Firestore |
| Tamper-proof audit copy | Every audit entry is copied to the `audit-locked` log bucket (365 days). | `mirrorAuditLog` → log sink `audit-to-locked` |
| Security alerts | Email to the security contact on: failed/refused staff sign-in steps, authenticator resets, staff sign-in email changes, screenshot attempts, forged payment webhooks, recording deletion requests and deletions, missing recordings. | Cloud Monitoring policy *Telemedicine security event* |
| Least-privilege functions | Functions run as `functions-runtime@…` with only the roles listed below. | `lib/core.js` |
| App Check | Requests carry proof they come from the real site (reCAPTCHA Enterprise). **Enforced** on Firestore, Storage, Authentication and (since 11 Oct 2026) every callable function. | Firebase console; `functions/lib/securityConfig.js` |
| API key restriction | The public web key only works from the hospital's sites. | Google Cloud credentials |
| Security headers | CSP, HSTS, no framing, etc. | `vercel.json` |
| Rule tests | `npm run test:rules` checks the access rules on the emulator (needs Java 21). Also run on GitHub for every push that changes the rules. | `tests/rules/`, `.github/workflows/rules-tests.yml` |

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
- Alert emails go to the addresses on the alert's notification channels
  (keep at least two hospital staff on it). To add people: Monitoring →
  **Alerting** → *Telemedicine security event* → edit notification
  channels.

## Cost and error alerts

Both email the "Security alerts (owner)" channel (Monitoring → Alerting →
notification channels; add more people there).

- **Telemedicine function errors** (alert policy): any Cloud Function that
  logs an error (failed email, payment check, scheduled job, crash). At
  most one email an hour; it closes itself after a day. To look: Logs
  Explorer, severity ERROR, around the alert time.
- **Telemedicine monthly spend** (budget on the project's billing account, USD 50 a month): emails at $20 spent, $50 spent
  and when the month is forecast to reach $50. A budget only warns; it
  never stops the app. Change it in Billing → Budgets & alerts.
- No function is kept always-on (no fixed cost). Instead the call screens
  wake `startVideoCall` shortly before a call (src/callWarmup.js), inside
  the free allowance.

## Staff inactivity

Staff are signed out after 30 idle minutes in the browser, and the server
and database rules refuse a staff account with no activity for 35 minutes
(`adminUsers.lastActiveAt`, updated at most once a minute while they work
or are in a call). Reloading the page doesn't revive an idle session; a
fresh sign-in (password + authenticator code) does.

## Deleting a patient

Admin → Users → Delete (type DELETE). Every booking of theirs is removed
and anything they paid for a consultation that never took place is
refunded in full automatically (Payment issues, "Patient account deleted
before the consultation"). History, payment records, consents, audit log
and recordings are kept. Deleting the account in the Firebase console
instead is also handled, by the daily maintenance run (within 24 hours).
To block access without deleting, use Deactivate.

## Data retention (to decide)

Nothing below is deleted automatically yet (hospital decision, October
2026: decide with management and legal, Ghana Data Protection Act):
`auditLog` (the locked 365-day copy in Cloud Logging is separate),
`consultationHistory`, and call `recordings` (deleted only by two admins).
Recordings are the largest and most sensitive: roughly 110 MB per
20-minute video call. Once periods are agreed, they can be enforced by a
nightly job.

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

1. **Sign-in reCAPTCHA stays in audit mode** (it scores sign-ins but
   blocks nothing). On 5 Oct 2026, enforce mode blocked a genuine admin
   sign-in, which showed up as "Invalid email or password", while a request
   with no reCAPTCHA token got through. Don't switch it to enforce on the
   live site. If you revisit it, test with a throwaway account and keep
   someone ready to run `node scripts/staffAdmin.js auth-recaptcha` (which
   sets audit) to undo it. Password guessing is still limited by Firebase's
   built-in throttling, the password policy and the staff authenticator.
2. **Replace the placeholders** in `components/shared/contact.js`: the
   hospital phone number and the WhatsApp support number.
3. **Paystack go-live** (in this order; see "Payments go-live checklist"
   below for the detail).
4. **Development against the live project.** `localhost` is an authorized
   sign-in domain and `.env` holds an App Check debug token, because
   development uses the live Firebase project. A debug token lets its
   holder past App Check: keep it out of Vercel and anywhere shared, and
   delete it in App Check → Apps → Manage debug tokens when you aren't
   developing. Better, once the hospital has time: a separate test
   Firebase project for development, then remove `localhost` here.

## Publish the current privacy policy

The privacy policy was saved in the admin editor on 4 Oct 2026, so the
site shows that saved copy rather than the built-in text, which has been
kept up to date since (age instead of date of birth, where data is stored,
two-admin recording access, staff inactivity). To publish the current
wording: admin → Control panel → Legal documents → Privacy policy →
**Start from the built-in text** → read it → **Review and save**. Have the
medical director (and, if possible, a lawyer) read the terms and privacy
policy before launch, and confirm the hospital is registered with Ghana's
Data Protection Commission as the data controller.

## Payments go-live checklist

Everything paid before go-live is Paystack TEST money. Do these in order.

1. **Ask Paystack** (one email): can they make PARTIAL refunds of mobile
   money payments (no-show refunds keep a share)? Does the hospital get
   Paystack's charge back when a payment is refunded? What is the hospital's
   Paystack settlement schedule? Refunds are paid from the Paystack balance,
   so keep enough in it.
2. **Clear the test data** (owner, from `functions/`):
   `node scripts/resetTestPayments.js` (dry run, shows counts), then
   `node scripts/resetTestPayments.js --confirm telemedicine-hfch`.
   Test call recordings are not touched: delete them in the app (two admins).
3. **Live secret key**: `firebase functions:secrets:set PAYSTACK_SECRET_KEY`
   (paste the LIVE secret key), then redeploy:
   `firebase deploy --only functions`.
4. **Live public key**: in Vercel, set `VITE_PAYSTACK_PUBLIC_KEY` to the
   LIVE public key (Production), then redeploy the site.
5. **Live webhook** in the Paystack dashboard, switched to Live mode:
   Settings → API Keys & Webhooks → Live Webhook URL =
   `https://europe-west1-telemedicine-hfch.cloudfunctions.net/paystackWebhook`.
   Test and live each have their own webhook URL; set the live one.
6. **One real test**: book a video call with a real wallet for a small
   price (set a low price in Control panel first, then put it back), check
   the booking appears, then refund it from Revenue → Refund requests (or
   wait for it as a no-show) and check the money arrives.
7. **Next morning**: in Google Cloud Logging, the `reconcilePaystack` job
   logs "Paystack reconciliation done" with how many payments it saw. If it
   ever reports payments the webhook had missed (audit code
   `payment.reconciled`), check the webhook URL in step 5.

