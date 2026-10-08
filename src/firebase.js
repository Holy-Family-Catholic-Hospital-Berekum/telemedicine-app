// firebase.js
//
// The one place Firebase is initialised. Import `app`, `db`, `auth`,
// `functions` from here (Storage: ./firebaseStorage.js); never call getFunctions() or
// getStorage() elsewhere, so every callable goes to the same region.
//
// The web config comes from VITE_* environment variables. It isn't a
// secret (any browser can see it), but keeping it in .env lets dev and
// production point at different projects.

import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import {
  initializeAuth,
  browserSessionPersistence,
  browserLocalPersistence,
  initializeRecaptchaConfig,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

// Every Cloud Function is deployed here (functions/lib/core.js REGION),
// inside Firestore's eur3 location.
export const FUNCTIONS_REGION = "europe-west1";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export { app };

// App Check: every request to Firestore, Storage and the Cloud Functions
// carries a token proving it comes from this website (reCAPTCHA Enterprise
// scores the visitor invisibly). With enforcement on (Firebase console for
// Firestore/Storage, functions/lib/securityConfig.js for functions),
// scripts and copies of the site using the public config are refused.
// See SECURITY_SETUP.md. Set before any other Firebase service is used.
const appCheckSiteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
if (import.meta.env.DEV) {
  // Local development: a debug token registered in the App Check console
  // (VITE_APPCHECK_DEBUG_TOKEN), or `true` to print a new one to the console.
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
}
export const appCheck = appCheckSiteKey
  ? initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    })
  : null;
export const db = getFirestore(app);
export const functions = getFunctions(app, FUNCTIONS_REGION);
// Storage lives in ./firebaseStorage.js (loaded only by pages that upload).
// initializeAuth rather than getAuth: no popupRedirectResolver, because the
// app never signs in with a popup or redirect. getAuth's resolver loads
// apis.google.com/js/api.js on every page, which the CSP blocks.
//
// Session-only persistence by default, so a session doesn't outlive the
// browser on a shared hospital machine. signIn() switches to local
// persistence only for a patient who ticks "remember me"; listing local
// second lets a remembered sign-in be picked up again on the next visit.
export const auth = initializeAuth(app, {
  persistence: [browserSessionPersistence, browserLocalPersistence],
});

// reCAPTCHA protection for email/password sign-in and sign-up, when it's
// switched on for the project (scripts/staffAdmin.js auth-recaptcha).
// Loads the project's settings up front; harmless when it's off.
initializeRecaptchaConfig(auth).catch(() => {});
