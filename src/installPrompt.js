// installPrompt.js
//
// "Add to home screen". Android Chrome fires `beforeinstallprompt` once,
// early, when the app is installable (manifest + service worker, see
// vite.config.js); we keep it so the patient dashboard can offer its own
// popup later (components/patient/dashboard/installAppPrompt.jsx). iPhones
// have no such event: the popup explains Share → Add to Home Screen.
// Imported once in src/index.jsx.

let deferred = null;
const listeners = new Set();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own popup instead of Chrome's bar
    deferred = e;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

/** Already opened from the home screen. */
export function isInstalled() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true
  );
}

/** iPhone / iPad Safari: no install event, show the manual steps. */
export function isIosSafari() {
  const ua = window.navigator.userAgent || "";
  const ios = /iphone|ipad|ipod/i.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return ios && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
}

export function canPrompt() {
  return Boolean(deferred);
}

/** Opens Chrome's install prompt. Resolves "accepted" | "dismissed" | null. */
export async function promptInstall() {
  if (!deferred) return null;
  const e = deferred;
  deferred = null;
  e.prompt();
  const { outcome } = await e.userChoice;
  listeners.forEach((l) => l());
  return outcome;
}

export function onInstallChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
