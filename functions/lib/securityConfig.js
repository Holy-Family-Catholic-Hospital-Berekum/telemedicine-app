// functions/lib/securityConfig.js
//
// Security switches and limits for the Cloud Functions. Not secret.
//
// ENFORCE_APP_CHECK: when true, every callable function rejects requests
//   that don't carry a valid App Check token (reCAPTCHA Enterprise in the
//   browser). Turn it on only once the App Check console shows nearly all
//   traffic as verified; see SECURITY_SETUP.md.
//
// Staff second factor (lib/core.js requireRole, both rules files):
//   admins and doctors sign in with an authenticator app (TOTP via
//   Identity Platform). The factor is pinned to the account only with a
//   one-time SETUP CODE handed over by IT or an admin (staffAuth.js), so
//   someone who only knows the password can't register their own
//   authenticator. A fresh sign-in is needed every STAFF_SESSION_MAX_HOURS.

module.exports = {
  ENFORCE_APP_CHECK: false,
  STAFF_SESSION_MAX_HOURS: 12,
  SETUP_CODE_HOURS: 72,
  SETUP_CODE_MAX_ATTEMPTS: 5,
};
