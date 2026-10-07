// src/constants.js
//
// Enum values shared with the Cloud Functions (functions/lib/core.js).
// Functions deploy from functions/ alone, so keep the two copies in step.

export const TYPE_LABELS = { OPD: "General OPD", SURGICAL: "Surgical" };
export const MODE_LABELS = { online: "Video call", in_person: "At the hospital" };
export const OUTCOME_LABELS = { completed: "Completed", no_show: "No-show" };

// Video room opens this long before the scheduled time. Keep in step with
// JOIN_OPENS_MINUTES_BEFORE in functions/consultations.js (server enforces).
export const CALL_UNLOCK_MINUTES = 30;
// ...and closes this long after it. Keep in step with
// JOIN_CLOSES_HOURS_AFTER in functions/consultations.js.
export const CALL_CLOSES_HOURS = 4;

/** Firestore Timestamp / Date / ISO string -> Date (or null). */
export function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Ghana is UTC+0 all year, but always format in the hospital's zone so a
// viewer abroad sees hospital time.
export const HOSPITAL_TIME_ZONE = "Africa/Accra";

// Dates always read day, month, year (hospital decision), whatever the
// device's language, e.g. "Thu 8 Oct 2026, 3:00 pm". Times use am/pm.
const DATE_LOCALE = "en-GB";

export function formatDateTime(value, options) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleString(DATE_LOCALE, {
    timeZone: HOSPITAL_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...options,
  });
}

/** e.g. "8 Oct 2026". */
export function formatDate(value, options) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleDateString(DATE_LOCALE, {
    timeZone: HOSPITAL_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    ...options,
  });
}

/** e.g. "3:00 pm". */
export function formatTime(value) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleTimeString(DATE_LOCALE, {
    timeZone: HOSPITAL_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Turns a Firebase callable error into something safe to show. */
export function callableMessage(err, fallback = "Something went wrong. Please try again.") {
  const code = String(err?.code || "").replace("functions/", "");
  if (
    [
      "invalid-argument",
      "failed-precondition",
      "not-found",
      "already-exists",
      "permission-denied",
      "resource-exhausted",
      "unauthenticated",
    ].includes(code) &&
    err?.message
  ) {
    return err.message;
  }
  if (code === "unavailable" || code === "deadline-exceeded") {
    return "Network problem. Check your connection and try again.";
  }
  return fallback;
}
