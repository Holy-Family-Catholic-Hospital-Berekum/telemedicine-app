# Security setup: App Check, reCAPTCHA and staff two-step sign-in

Follow these steps in order. They're written for whoever owns the Firebase
project (`telemedicine-hfch`) and the Vercel project. Steps 1–5 are all
console work and safe to do at any time. **Don't deploy (step 6) until
1–5 are done**, or admins won't be able to sign in.

What you're switching on:

| Protection | Who it protects | Where it's enforced |
|---|---|---|
| **Admin authenticator app (TOTP)** | Admin accounts | Every Cloud Function, Firestore rules, Storage rules |
| **Doctor emailed sign-in code** | Doctor accounts | Same as above (active once email sending is set up, step 8) |
| **reCAPTCHA on sign-in/sign-up** | All accounts, against password guessing bots | Firebase Authentication |
| **App Check (reCAPTCHA Enterprise)** | All data, against scripts and copied sites using the public config | Firestore, Storage, Cloud Functions (switched on last, step 9) |
| **Password policy** | All accounts | Firebase Authentication (matches the sign-up page) |

---

## 0. Before you start

1. Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install).
2. Sign in with an account that is **Owner** of the Firebase project:
   ```
   gcloud auth application-default login
   gcloud config set project telemedicine-hfch
   ```
3. Make sure that Google account itself has 2-Step Verification on
   (myaccount.google.com → Security). Whoever controls this account
   controls all patient data.

All `node scripts/...` commands below are run from the `functions/` folder.

## 1. Upgrade Authentication to Identity Platform

Two-step sign-in, the password policy and sign-in reCAPTCHA need it.

1. Firebase console → **Authentication** → **Settings** tab.
2. Click **Upgrade to Firebase Authentication with Identity Platform** and
   confirm. The project is already on Blaze. Email/password sign-in stays
   free up to 50,000 monthly active users, and authenticator-app codes have
   no per-use charge.
3. Same Settings tab → **User actions** → turn on **Email enumeration
   protection** (stops anyone checking which emails have accounts).
4. Same tab → **Authorized domains**: keep only domains you use
   (`telemedicine-hfch.vercel.app`, `telemedicine-hfch.firebaseapp.com`,
   `localhost` for development, and your custom domain once you have it).

## 2. Turn on authenticator sign-in and the password policy

```
cd functions
node scripts/staffAdmin.js enable-totp
node scripts/staffAdmin.js password-policy
```

Each prints what it changed. The password policy is the same rule the
sign-up page already shows (10+ characters, upper and lower case, a
number and a symbol). Existing accounts with weaker passwords can still
sign in; new passwords must follow it.

## 3. Create the reCAPTCHA Enterprise key (for App Check)

1. Google Cloud console → make sure the project is `telemedicine-hfch` →
   search **reCAPTCHA Enterprise** → **Enable** the API.
2. **Create key**:
   - Display name: `telemedicine web (App Check)`
   - Platform: **Website**
   - Domains: `telemedicine-hfch.vercel.app` (add your custom domain later;
     don't add `localhost`, development uses a debug token instead)
   - Leave **"Use checkbox challenge"** off (it's invisible and score-based)
3. Copy the **key ID** (the site key). It's not secret.

## 4. Register the website with App Check

1. Firebase console → **App Check** → **Apps** tab → your web app →
   **reCAPTCHA Enterprise** → paste the site key → **Save**.
   Leave the token time-to-live at the default (1 hour).
2. **Don't press Enforce yet.** That's step 9.
3. Vercel → the project → **Settings** → **Environment Variables** → add:
   - `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` = the site key, for
     **Production** and **Preview**.
4. For local development, add the same line to your `.env`. Then:
   1. Run `npm run dev` and open the site. The browser console prints
      *"App Check debug token: …"*.
   2. Firebase console → App Check → Apps → your web app → ⋮ →
      **Manage debug tokens** → add that token.
   3. Put it in `.env` as `VITE_APPCHECK_DEBUG_TOKEN=…`.

   **Never** put the debug token in Vercel; it lets anyone past App Check.

## 5. Turn on reCAPTCHA for sign-in and sign-up

```
node scripts/staffAdmin.js auth-recaptcha
```

This makes Firebase score every email/password sign-in and sign-up and
block the most bot-like ones (score 0.3 or lower). Firebase creates and
manages its own reCAPTCHA key for this, so it's separate from step 3.
The site already loads the settings (`initializeRecaptchaConfig` in
`src/firebase.js`).

## 6. Deploy

```
firebase deploy --only firestore,storage,functions
git push origin main        # Vercel rebuilds the site with the new env var
```

Deploy Firebase first, then push. If you changed the Vercel environment
variable after the last build, redeploy in Vercel too (Deployments → ⋮ →
Redeploy) so the site picks it up.

## 7. Each admin sets up their authenticator (do this straight away)

Until an admin has done this, anyone who learns their password could set
up an authenticator in their place, so do it right after deploying.

1. Install **Google Authenticator** or **Microsoft Authenticator** on a
   phone only you use. Turn on the app's own lock (PIN or fingerprint).
2. Go to the staff sign-in page and sign in with your email and password.
   (If it says the account's email isn't verified, run
   `node scripts/staffAdmin.js make-admin <email> "<name>"` again for that
   admin; it marks the staff email as verified.)
3. The page shows **Set up your authenticator** with a QR code. Scan it in
   the app (or type the key shown under it).
4. Type the 6-digit code from the app → **Finish setup**.
5. Sign in again. This time you'll be asked for the app's code.
6. Admin dashboard → **Audit** tab: check for *"Registered an
   authenticator app for admin sign-in"* with your name.

From now on, every admin sign-in needs the password **and** the app code,
and has to be repeated at least every 12 hours. Only the authenticator
registered at that first sign-in is accepted. A second one added later by
anyone else doesn't work.

**Lost or replaced phone:** someone with project Owner access runs
```
node scripts/staffAdmin.js reset-mfa admin@yourhospital.org
```
**after confirming in person, or by calling a number you already have,
that the request is genuine.** Never do it on the strength of an email
alone; that is exactly what an attacker would send. The admin then
repeats step 7.

**New admins:** `node scripts/staffAdmin.js make-admin <email> "<name>"`,
then they do step 7 at once, ideally with you present.

## 8. Doctor sign-in codes (needs email sending)

Doctors sign in with password **plus** a 6-digit code emailed to them,
which works only for that sign-in, expires after 10 minutes and allows
5 tries.

This needs the email setup that appointment emails use. **Until it's done,
doctors sign in without a code**, and every such sign-in is written to the
audit log as *"Doctor signed in without an email code (email sending isn't
set up yet)"*. Do this before launch:

1. Buy or choose the hospital's domain, add it in [Resend](https://resend.com),
   and add the DNS records Resend gives you (SPF, DKIM) plus a DMARC record.
2. In `functions/lib/mailConfig.js` set `FROM` and `REPLY_TO` to addresses
   on that domain.
3. `firebase functions:secrets:set RESEND_API_KEY` (paste the Resend API key).
4. `firebase deploy --only functions`.
5. Sign in as a doctor: you should get the code email within a minute.

Doctors' email accounts become part of their sign-in. Ask each doctor to
turn on 2-step verification for their email account, because whoever
controls the mailbox can reset the password *and* read the code.

## 9. Enforce App Check (after a few days of monitoring)

Enforcing too early blocks real users, so watch first.

1. Firebase console → **App Check** → **APIs** tab. For **Cloud Firestore**,
   **Cloud Storage** and **Cloud Functions**, open the metrics. Wait until
   nearly all requests show as **Verified** (allow 2–3 days of normal use;
   people with very old cached pages show as unverified at first).
2. Then:
   - Cloud Firestore → **Enforce**.
   - Cloud Storage → **Enforce**.
   - Cloud Functions: in `functions/lib/securityConfig.js` set
     `ENFORCE_APP_CHECK: true`, then `firebase deploy --only functions`.
   - Optional: **Authentication** → Enforce (App Check for Identity
     Platform), once its metrics also look verified.
3. Test: sign in as a patient, book (test payment), join a test call; sign
   in as a doctor and an admin. If anything fails with "App Check" in the
   browser console, set the function flag back to `false` and redeploy (or
   press **Unenforce** in the console) while you investigate.

The Paystack webhook isn't affected: it's called by Paystack's servers
and is protected by Paystack's signature instead.

## 10. Restrict the browser API key

The Firebase web API key is public by design, but it should only work
from your sites.

1. Google Cloud console → **APIs & Services** → **Credentials** → the key
   named *Browser key (auto created by Firebase)*.
2. **Application restrictions** → **Websites** → add
   `https://telemedicine-hfch.vercel.app/*`,
   `https://telemedicine-hfch.firebaseapp.com/*` and `http://localhost:5173/*`
   (and your custom domain later).
3. **API restrictions** → **Restrict key** → select: Identity Toolkit API,
   Token Service API, Cloud Firestore API, Cloud Storage for Firebase API,
   Firebase App Check API, Cloud Functions API, reCAPTCHA Enterprise API,
   Firebase Installations API. Save.
4. Check sign-in, booking and the admin dashboard still work.

## Quick checks after setup

- [ ] Admin sign-in asks for the authenticator code; a wrong code is refused.
- [ ] Admin Audit tab shows *Registered an authenticator app*.
- [ ] Doctor sign-in asks for an emailed code (after step 8).
- [ ] Signing in on a second browser with the same doctor password doesn't
      get access without its own code.
- [ ] Patient sign-up and sign-in still work.
- [ ] App Check metrics show requests as verified (step 9).
