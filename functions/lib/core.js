// functions/lib/core.js
//
// Shared plumbing for every Cloud Function: one Admin SDK instance, one
// region, role checks, input validation, audit entries and rate limits.
// Every module requires this file first, so initializeApp() and
// setGlobalOptions() run before any function is defined.
//
// Security model (keep it intact):
// - The browser is untrusted. Role comes from the `role` custom claim,
//   which only these functions set, and the matching Firestore profile must
//   be `active`. A missing claim means no access.
// - Every write to bookings, consultations, payments, recordings, consents
//   and the audit log happens here, with the Admin SDK. Security Rules deny
//   those writes to clients.

const crypto = require("crypto");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { getStorage } = require("firebase-admin/storage");
const { setGlobalOptions } = require("firebase-functions/v2");
const { HttpsError, onCall: rawOnCall } = require("firebase-functions/v2/https");
const {
  ENFORCE_APP_CHECK,
  ADMIN_SESSION_MAX_HOURS,
} = require("./securityConfig");

if (!getApps().length) initializeApp();

// firebase-admin v14 is modular-only; this keeps call sites short
// (admin.auth(), admin.storage().bucket()).
const admin = { auth: () => getAuth(), storage: () => getStorage() };

// The single region for every function. Firestore is in eur3, which
// europe-west1 sits inside. Keep in step with FUNCTIONS_REGION in
// src/firebase.js.
const REGION = "europe-west1";
setGlobalOptions({ region: REGION, maxInstances: 10 });

const db = getFirestore();
const serverTime = () => FieldValue.serverTimestamp();

/**
 * Every callable is defined through this, so App Check is enforced on all
 * of them at once (lib/securityConfig.js ENFORCE_APP_CHECK). Same
 * signature as firebase-functions' onCall: (handler) or (options, handler).
 */
function onCall(optionsOrHandler, maybeHandler) {
  const handler = typeof optionsOrHandler === "function" ? optionsOrHandler : maybeHandler;
  const options = typeof optionsOrHandler === "function" ? {} : optionsOrHandler;
  return rawOnCall({ enforceAppCheck: ENFORCE_APP_CHECK, ...options }, handler);
}

// Enum values shared with the client (src/constants.js). Functions deploy
// from functions/ alone, so the two copies must be kept in step by hand.
const TYPES = ["OPD", "SURGICAL"];
const TYPE_LABELS = { OPD: "General OPD", SURGICAL: "Surgical" };
const MODES = ["online", "in_person"];
const SEXES = ["female", "male"];
const OUTCOMES = ["completed", "no_show"];
const STAFF_ROLES = ["admin", "doctor"];
// Call recording: off, video (picture + sound) or audio only.
const RECORDING_MODES = ["off", "video", "audio"];

/** Recording mode from systemSettings/features (older docs had a boolean). */
function recordingModeOf(features) {
  const mode = features?.callRecordingMode;
  if (RECORDING_MODES.includes(mode)) return mode;
  return features?.callRecordingEnabled === true ? "video" : "off";
}

/* ------------------------------------------------------------------ */
/* identity                                                            */
/* ------------------------------------------------------------------ */

function profileRef(uid, role) {
  return db
    .collection(role === "patient" ? "users" : "adminUsers")
    .doc(uid);
}

/**
 * Staff second factor, checked on every staff call (and mirrored in
 * firestore.rules / storage.rules):
 *
 * Admin: this sign-in used the authenticator app (TOTP), with the one
 *   factor pinned to the account (adminUsers.mfaFactorUid — a factor added
 *   later by someone else doesn't count), and happened within
 *   ADMIN_SESSION_MAX_HOURS.
 * Doctor: staffSessions/{uid} says this exact sign-in (the token's
 *   auth_time) was confirmed with an emailed code (staffAuth.js) and
 *   hasn't expired. Another sign-in with the same password, elsewhere,
 *   has a different auth_time and gets nothing.
 */
const MFA_REQUIRED = { reason: "mfa_required" };

function assertAdminSecondFactor(token, profile) {
  const fb = token.firebase || {};
  const ageSeconds = Date.now() / 1000 - Number(token.auth_time || 0);
  if (
    fb.sign_in_second_factor !== "totp" ||
    !profile.mfaFactorUid ||
    fb.second_factor_identifier !== profile.mfaFactorUid ||
    !(ageSeconds < ADMIN_SESSION_MAX_HOURS * 3600)
  ) {
    throw new HttpsError(
      "permission-denied",
      "Please sign in again with your authenticator code.",
      MFA_REQUIRED,
    );
  }
}

async function doctorSessionVerified(uid, token) {
  const snap = await db.collection("staffSessions").doc(uid).get();
  const s = snap.exists ? snap.data() : null;
  return Boolean(
    s &&
      s.verified === true &&
      s.authTime === Number(token.auth_time) &&
      (s.expiresAt?.toMillis?.() ?? 0) > Date.now(),
  );
}

/**
 * Rejects unless the caller is signed in, holds one of `roles` in the
 * signed `role` claim, and their profile document says `active`. Reading
 * the profile on every call means a deactivated account loses access at
 * once, not when its ID token next refreshes. Staff must also have passed
 * their second factor for this sign-in (see above).
 *
 * Returns { uid, role, profile, token }.
 */
async function requireRole(request, roles) {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Please sign in to continue.");
  }
  const role = auth.token.role;
  if (!roles.includes(role)) {
    throw new HttpsError(
      "permission-denied",
      "Your account can't do that.",
    );
  }
  const snap = await profileRef(auth.uid, role).get();
  if (!snap.exists || snap.data().status !== "active") {
    throw new HttpsError(
      "permission-denied",
      "This account is not active. Please contact the hospital.",
    );
  }
  const profile = snap.data();
  if (role === "admin") assertAdminSecondFactor(auth.token, profile);
  if (role === "doctor" && !(await doctorSessionVerified(auth.uid, auth.token))) {
    throw new HttpsError(
      "permission-denied",
      "Please sign in again and enter the code we email you.",
      MFA_REQUIRED,
    );
  }
  return { uid: auth.uid, role, profile, token: auth.token };
}

/** Patients must have verified their email before booking or joining. */
function requireVerifiedEmail(caller) {
  if (caller.token.email_verified !== true) {
    throw new HttpsError(
      "failed-precondition",
      "Please verify your email address first.",
    );
  }
}

/** IP and user agent as seen by the function, for consent and audit. */
function requestMeta(request) {
  const raw = request.rawRequest;
  const ua = raw?.headers?.["user-agent"];
  return {
    ip: raw?.ip || null,
    userAgent: typeof ua === "string" ? ua.slice(0, 300) : null,
  };
}

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

function str(value, { field, max = 120, min = 1, optional = false }) {
  if (value === undefined || value === null || value === "") {
    if (optional) return null;
    throw new HttpsError("invalid-argument", `${field} is required.`);
  }
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${field} is not valid.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min) {
    if (optional && trimmed.length === 0) return null;
    throw new HttpsError("invalid-argument", `${field} is required.`);
  }
  if (trimmed.length > max) {
    throw new HttpsError(
      "invalid-argument",
      `${field} is too long (limit ${max} characters).`,
    );
  }
  return trimmed;
}

function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new HttpsError("invalid-argument", `Choose a valid ${field}.`);
  }
  return value;
}

/** Firestore-safe document ID supplied by a client. */
function docId(value, field) {
  const id = str(value, { field, max: 128 });
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new HttpsError("invalid-argument", `${field} is not valid.`);
  }
  return id;
}

/** ISO 8601 date-time string -> Date, or throws. */
function isoDateTime(value, field) {
  const s = str(value, { field, max: 40 });
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new HttpsError("invalid-argument", `${field} is not a valid time.`);
  }
  return d;
}

/** YYYY-MM-DD, a real calendar date in the past. */
function dateOfBirth(value) {
  const s = str(value, { field: "Date of birth", max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new HttpsError("invalid-argument", "Enter a valid date of birth.");
  }
  const d = new Date(`${s}T00:00:00Z`);
  const now = new Date();
  if (
    Number.isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== s ||
    d > now ||
    d.getUTCFullYear() < 1900
  ) {
    throw new HttpsError("invalid-argument", "Enter a valid date of birth.");
  }
  return s;
}

/** Whole years between a YYYY-MM-DD date of birth and `now`. */
function ageInYears(dob, now = new Date()) {
  const [y, m, d] = dob.split("-").map(Number);
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age--;
  return age;
}

/** Ghana numbers to E.164 (+233XXXXXXXXX); other countries kept as dialled. */
function phoneE164(raw) {
  const s = str(raw, { field: "Phone number", max: 20 });
  let digits = s.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 10) {
    digits = "233" + digits.slice(1);
  }
  if (digits.length === 9) digits = "233" + digits;
  if (digits.length < 10 || digits.length > 15) {
    throw new HttpsError("invalid-argument", "Enter a valid phone number.");
  }
  return `+${digits}`;
}

/** Firestore Timestamp / Date / ISO string -> Date (or null). */
function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ------------------------------------------------------------------ */
/* ids, hashing                                                        */
/* ------------------------------------------------------------------ */

// No 0/O/1/I/L: the ID is read out over the phone and typed by hand.
const ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomCode(length) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    // 256 % 31 bias is negligible for an identifier that is not a secret.
    out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  }
  return out;
}

function newConsultationId() {
  return `HFC-${randomCode(10)}`;
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/* ------------------------------------------------------------------ */
/* audit                                                               */
/* ------------------------------------------------------------------ */

/**
 * Appends one auditLog entry. Pass a transaction or batch as `writer` to
 * make the entry part of the same commit as the change it describes.
 *
 * actorId / action / targetId / timestamp are what the admin Audit tab
 * shows; the rest is for filtering and evidence. `details` must never
 * hold patient data (field names and IDs, not values).
 */
function audit(writer, entry) {
  const ref = db.collection("auditLog").doc();
  const doc = {
    actorId: entry.actorId || "system",
    actorRole: entry.actorRole || "system",
    action: entry.action,
    code: entry.code,
    category: entry.category,
    targetType: entry.targetType || null,
    targetId: entry.targetId || null,
    patientUid: entry.patientUid || null,
    result: entry.result || "success",
    reason: entry.reason || null,
    details: entry.details || null,
    ip: entry.meta?.ip || null,
    userAgent: entry.meta?.userAgent || null,
    timestamp: serverTime(),
  };
  if (writer) {
    writer.set(ref, doc);
    return Promise.resolve();
  }
  return ref.set(doc);
}

/* ------------------------------------------------------------------ */
/* rate limiting                                                       */
/* ------------------------------------------------------------------ */

/**
 * Fixed-window counter per uid and action. Throws resource-exhausted once
 * `max` calls land inside `windowSeconds`.
 */
async function rateLimit(uid, action, { max, windowSeconds }) {
  const ref = db.collection("rateLimits").doc(`${action}_${uid}`);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const windowStart = data?.windowStart?.toMillis?.() ?? 0;
    if (data && now - windowStart < windowSeconds * 1000) {
      if (data.count >= max) {
        throw new HttpsError(
          "resource-exhausted",
          "Too many requests. Please wait a while and try again.",
        );
      }
      tx.update(ref, { count: FieldValue.increment(1) });
    } else {
      tx.set(ref, {
        count: 1,
        windowStart: Timestamp.fromMillis(now),
        // maintenance.js cleanupRateLimits removes old counters.
        expiresAt: Timestamp.fromMillis(now + windowSeconds * 1000 * 2),
      });
    }
  });
}

/** Deletes a document and every subcollection under it. */
function deleteTree(ref) {
  return db.recursiveDelete(ref);
}

module.exports = {
  onCall,
  assertAdminSecondFactor,
  doctorSessionVerified,
  profileRef,
  admin,
  db,
  FieldValue,
  Timestamp,
  serverTime,
  REGION,
  TYPES,
  TYPE_LABELS,
  MODES,
  SEXES,
  OUTCOMES,
  STAFF_ROLES,
  RECORDING_MODES,
  recordingModeOf,
  HttpsError,
  requireRole,
  requireVerifiedEmail,
  requestMeta,
  str,
  oneOf,
  docId,
  isoDateTime,
  dateOfBirth,
  ageInYears,
  phoneE164,
  toDate,
  newConsultationId,
  randomCode,
  sha256,
  audit,
  rateLimit,
  deleteTree,
};
