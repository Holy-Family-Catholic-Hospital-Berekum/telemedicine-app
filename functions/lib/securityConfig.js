// functions/lib/securityConfig.js
//
// Security switches and limits for the Cloud Functions. Not secret.
//
// ENFORCE_APP_CHECK: when true, every callable function rejects requests
//   that don't carry a valid App Check token (reCAPTCHA Enterprise in the
//   browser). Turn it on only after the site key is set in Vercel
//   (VITE_RECAPTCHA_ENTERPRISE_SITE_KEY), the site is redeployed, and the
//   App Check console shows the requests as "verified" — otherwise every
//   call fails. See SECURITY_SETUP.md.
//
// Staff second factor (always enforced; see lib/core.js requireRole):
//   admin  — authenticator app (TOTP via Identity Platform), pinned to the
//            one factor enrolled (adminUsers.mfaFactorUid), and a fresh
//            sign-in at least every ADMIN_SESSION_MAX_HOURS.
//   doctor — a 6-digit code emailed for each sign-in (staffAuth.js), valid
//            for that sign-in session only, for DOCTOR_SESSION_MAX_HOURS.

module.exports = {
  ENFORCE_APP_CHECK: false,
  ADMIN_SESSION_MAX_HOURS: 12,
  DOCTOR_SESSION_MAX_HOURS: 12,
  STAFF_CODE_MINUTES: 10,
  STAFF_CODE_MAX_ATTEMPTS: 5,
};
