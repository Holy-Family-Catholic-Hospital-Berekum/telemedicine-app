// firebase.js
//
// If this project already initializes Firebase elsewhere (it likely
// does — docFirestoreService.js / patientFirestoreService.js need it
// too), this IS that file, just extended with Auth for signIn/signUp/
// authContext. Nothing else here changed.
//
//   1. console.firebase.google.com -> create/select your project
//   2. Project settings -> General -> "Your apps" -> add a Web app
//   3. Copy the firebaseConfig object it gives you into the object below
//   4. Firestore Database -> Create database (start in production mode,
//      not test mode, then add the security rules from
//      firestore.rules.example) -> pick the region closest to your
//      hospital's users
//
// Keep the actual key values in environment variables rather than
// committed to source — Vite exposes them via import.meta.env.VITE_*.
// The Firebase web config isn't a secret the way a server API key is
// (it's visible in any browser's network tab regardless), but env vars
// still make it easy to use different Firebase projects for dev vs.
// production.

import { initializeApp } from "firebase/app";
import { getAuth, browserSessionPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const functions = getFunctions(app);
export const auth = getAuth(app);

// Default to session-only persistence (cleared when the browser/tab
// closes) rather than staying signed in indefinitely. This matters on
// shared hospital front-desk machines — we don't want a logged-in
// admin session surviving for the next person who sits down. signIn.jsx
// opts into local persistence only when a user explicitly checks
// "remember me" on their own device.
auth.setPersistence(browserSessionPersistence).catch(() => {
  // Non-fatal — falls back to Firebase's default persistence.
});
