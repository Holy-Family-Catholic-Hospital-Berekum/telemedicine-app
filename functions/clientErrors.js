// functions/clientErrors.js
//
//   reportClientError  callable: an error in a visitor's browser (sent by
//                      src/errorReporting.js), written to Cloud Logging as a
//                      "CLIENT_ERROR" line. The alert policy "Telemedicine
//                      website errors" emails the owner (at most hourly).
//
// Anyone may call it (errors happen before sign-in too), but App Check
// still applies (lib/core.js onCall), so only the real website can, and
// it is rate-limited per caller. Nothing personal is kept: the browser
// already strips emails, phone numbers and booking references, this
// strips them again, the page is reported as a path only (no query or
// #hash, where sign-in links carry codes), and only the caller's role is
// logged, never who they are.

const logger = require("firebase-functions/logger");
const { onCall, HttpsError, rateLimit, requestMeta, sha256 } = require("./lib/core");

const KINDS = ["error", "unhandledrejection", "react", "chunk"];

/** Removes personal details and anything that looks like a secret. */
function scrub(text, max) {
  return String(text || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/HF[CHT]-[A-Z0-9-]{4,}/gi, "[reference]")
    .replace(/\+?\d[\d\s-]{6,}\d/g, "[number]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    .slice(0, max);
}

const text = (v, max) => (typeof v === "string" ? scrub(v, max) : "");

exports.reportClientError = onCall(async (request) => {
  const d = request.data || {};
  const meta = requestMeta(request);
  // Per account, or per (hashed) address for visitors not signed in.
  const caller = request.auth?.uid || `ip-${sha256(String(meta.ip || "unknown")).slice(0, 16)}`;
  await rateLimit(caller, "clientError", { max: 30, windowSeconds: 3600 });

  const message = text(d.message, 300);
  if (!message) throw new HttpsError("invalid-argument", "No error message.");
  const path = typeof d.path === "string" && d.path.startsWith("/") ? scrub(d.path.split(/[?#]/)[0], 120) : "?";

  logger.warn("CLIENT_ERROR", {
    kind: KINDS.includes(d.kind) ? d.kind : "error",
    message,
    stack: text(d.stack, 2000),
    path,
    build: text(d.build, 20) || null,
    role: typeof request.auth?.token?.role === "string" ? request.auth.token.role : "visitor",
    online: d.online !== false,
    userAgent: meta.userAgent,
  });
  return { ok: true };
});

exports.scrub = scrub;
