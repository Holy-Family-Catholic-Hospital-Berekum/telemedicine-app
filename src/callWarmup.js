// callWarmup.js
//
// Wakes the startVideoCall function shortly before someone can join a
// call, so "Join" doesn't wait for a cold start (hospital decision: no
// always-on instance, which would cost a fixed amount every month). Each
// warm-up is one tiny call inside Firebase's free allowance; the function
// answers { warm: true } without reading or writing anything.
// Used by the patient join panel / camera check and the doctor's
// appointment card while the video room is open.

import { useEffect } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

const callStartVideoCall = httpsCallable(functions, "startVideoCall");
// A warmed function stays up for several minutes; don't send more often.
const MIN_GAP_MS = 4 * 60 * 1000;
let lastWarm = 0;

export function warmCallServer() {
  const now = Date.now();
  if (now - lastWarm < MIN_GAP_MS) return;
  lastWarm = now;
  callStartVideoCall({ warmup: true }).catch(() => {});
}

/** Keeps the call server warm while `active` (the video room is open). */
export function useCallWarmup(active) {
  useEffect(() => {
    if (!active) return undefined;
    warmCallServer();
    const id = setInterval(warmCallServer, MIN_GAP_MS);
    return () => clearInterval(id);
  }, [active]);
}
