// featureFlags.js
//
// Reads feature toggles from a single Firestore doc so they can be
// flipped without a redeploy. Currently just call recording; add more
// fields to the same doc as needed later.
//
// The admin UI that WRITES to this doc isn't built yet (out of scope
// for this change, per the request). Until it exists, toggle it
// directly in the Firebase console:
//   systemSettings/features  { callRecordingEnabled: true|false }
// If the doc doesn't exist yet, recording defaults to OFF.
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../src/firebase";

export async function isCallRecordingEnabled() {
  try {
    const snap = await getDoc(doc(db, "systemSettings", "features"));
    return snap.exists() && snap.data()?.callRecordingEnabled === true;
  } catch (err) {
    console.warn(
      "Couldn't read feature flags, defaulting recording to off:",
      err,
    );
    return false;
  }
}
