// networkStatus.js
//
// What the connection banner (components/shared/networkBanner.jsx) shows:
//   offline  the browser says there's no connection
//   slow     a request the app is waiting on has taken longer than
//            SLOW_AFTER_MS (patients and staff see "still trying…" instead
//            of a page that seems stuck)
// Data loads and server calls that people wait on are wrapped in
// track(promise); nothing here retries or changes the request itself.

import { useSyncExternalStore } from "react";

const SLOW_AFTER_MS = 6000;

let pending = 0; // tracked requests past SLOW_AFTER_MS
let offline = typeof navigator !== "undefined" && navigator.onLine === false;
let snapshot = { offline, slow: false };
const listeners = new Set();

function publish() {
  const next = { offline, slow: pending > 0 };
  if (next.offline === snapshot.offline && next.slow === snapshot.slow) return;
  snapshot = next;
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    offline = false;
    publish();
  });
  window.addEventListener("offline", () => {
    offline = true;
    publish();
  });
}

/** Resolves/rejects like `promise`; marks the connection slow while it's late. */
export function track(promise) {
  let late = false;
  const timer = setTimeout(() => {
    late = true;
    pending += 1;
    publish();
  }, SLOW_AFTER_MS);
  const done = () => {
    clearTimeout(timer);
    if (late) {
      pending -= 1;
      publish();
    }
  };
  promise.then(done, done);
  return promise;
}

/** { offline, slow } */
export function useNetworkStatus() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
    () => snapshot,
  );
}

/** Wraps an async function (e.g. a callable) so its calls are tracked. */
export function tracked(fn) {
  return (...args) => track(fn(...args));
}
