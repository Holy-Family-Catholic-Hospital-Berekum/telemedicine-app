// src/errorReporting.js
//
// Sends errors that happen in a visitor's browser to the server
// (functions/clientErrors.js reportClientError), which logs them in Google
// Cloud; the owner gets an email alert ("Telemedicine website errors").
// Hospital decision: our own logging, no outside error service.
//
// What is sent: the error message and stack, the page PATH (never the
// ?query or #hash, where sign-in links carry codes), whether the browser
// was online, and the build. Emails, phone numbers and booking references
// are removed here and again on the server. Nothing is sent while offline
// (those errors are the connection, not a bug), nothing from browser
// extensions, the same error only once and at most 5 per page load.
// Firebase is loaded only when there is something to send.

const MAX_PER_PAGE = 5;
const sent = new Set();
let count = 0;

const IGNORE = [
  /ResizeObserver loop/i, // harmless browser warning
  /^Script error\.?$/i, // cross-origin script: no details to act on
  /chrome-extension:|moz-extension:|safari-extension:/i,
  /AbortError|The user aborted a request/i,
];
// A page or code file that couldn't be fetched: usually the connection, but
// while online it can mean a broken deploy, so it is reported as "chunk".
const CHUNK = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk \d+ failed/i;

function scrub(text, max) {
  return String(text || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/HF[CHT]-[A-Z0-9-]{4,}/gi, "[reference]")
    .replace(/\+?\d[\d\s-]{6,}\d/g, "[number]")
    .slice(0, max);
}

/** Report one error. kind: "error" | "unhandledrejection" | "react". */
export function reportError(error, kind = "error") {
  try {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const message = scrub(error?.message || String(error || ""), 300);
    const stack = scrub(error?.stack || "", 2000);
    if (!message || IGNORE.some((re) => re.test(message) || re.test(stack))) return;
    const key = `${kind}:${message}`;
    if (sent.has(key) || count >= MAX_PER_PAGE) return;
    sent.add(key);
    count += 1;

    const payload = {
      kind: CHUNK.test(message) ? "chunk" : kind,
      message,
      stack,
      path: window.location.pathname,
      build: import.meta.env.VITE_BUILD_ID || "",
      online: navigator.onLine !== false,
    };
    Promise.all([import("./firebase.js"), import("firebase/functions")])
      .then(([{ functions }, { httpsCallable }]) => httpsCallable(functions, "reportClientError")(payload))
      .catch(() => {}); // never let reporting cause another error
  } catch {
    // ignore
  }
}

/** Listen for uncaught errors and failed promises (once, at start-up). */
export function installErrorReporting() {
  if (typeof window === "undefined" || import.meta.env.DEV) return; // local development: the console is enough
  window.addEventListener("error", (e) => reportError(e.error || e.message, "error"));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason, "unhandledrejection"));
}
