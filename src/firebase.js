// firebase.js
//
// The one place Firebase is initialised. Import `app`, `db`, `auth`,
// `functions` and `storage` from here; never call getFunctions() or
// getStorage() elsewhere, so every callable goes to the same region.
//
// The web config comes from VITE_* environment variables. It isn't a
// secret (any browser can see it), but keeping it in .env lets dev and
// production point at different projects.

import { initializeApp } from "firebase/app";
import { getAuth, browserSessionPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

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
export const db = getFirestore(app);
export const functions = getFunctions(app, FUNCTIONS_REGION);
export const storage = getStorage(app);
export const auth = getAuth(app);

// Session-only persistence by default, so a session doesn't outlive the
// browser on a shared hospital machine. signIn() opts into local
// persistence only for a patient who ticks "remember me".
auth.setPersistence(browserSessionPersistence).catch(() => {
  // Non-fatal — falls back to Firebase's default persistence.
});
