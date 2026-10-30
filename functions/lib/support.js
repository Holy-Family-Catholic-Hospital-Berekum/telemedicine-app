// functions/lib/support.js
//
// In-app support messages (functions/support.js): the rules that don't
// need the database, so they can be unit-tested.
//
// Office hours (hospital decision, 30 Oct 2026): Monday to Friday, 08:00
// to 17:00 Ghana time (Africa/Accra = UTC, no daylight saving, so UTC
// arithmetic is exact). Public holidays aren't known here: a message on a
// holiday gets no "we're closed" email. The website shows the same hours
// (components/patient/support/supportHours.js: keep the two in step).

const TOPICS = {
  booking: "Booking or appointment time",
  payment: "Payment or refund",
  video_call: "Joining a video call",
  prescription: "Prescription",
  account: "My account",
  other: "Something else",
};

const LIMITS = {
  text: 2000, // characters per message
  openThreads: 3, // conversations waiting for us or answered, per patient
  messagesPerThread: 60,
};

// An answered conversation the patient doesn't reply to is closed after
// this, and every closed conversation is deleted this long after closing
// (hospital decision: 30 days), messages and all.
const AUTO_CLOSE_DAYS = 7;
const DELETE_AFTER_CLOSE_DAYS = 30;
const DAY_MS = 86400 * 1000;

const OPEN_HOUR = 8;
const CLOSE_HOUR = 17;
const isWeekday = (d) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5;

/** True during office hours. */
function isOfficeOpen(date) {
  const h = date.getUTCHours();
  return isWeekday(date) && h >= OPEN_HOUR && h < CLOSE_HOUR;
}

/** When the office next opens (`date` itself if it's open now). */
function nextOpening(date) {
  if (isOfficeOpen(date)) return date;
  const d = new Date(date);
  if (d.getUTCHours() >= OPEN_HOUR) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(OPEN_HOUR, 0, 0, 0);
  while (!isWeekday(d)) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/**
 * Whether a patient message sent at `now` gets the "we'll reply when we
 * open" email: outside office hours, and only once per closed period per
 * conversation (`noticeFor` = the opening time the last such email
 * announced, in ms).
 */
function needsAfterHoursNotice(now, noticeFor) {
  if (isOfficeOpen(now)) return false;
  return Number(noticeFor) !== nextOpening(now).getTime();
}

/**
 * Message text as stored: Windows line ends made "\n", control characters
 * other than newline and tab removed, at most two blank lines in a row.
 * Shown as plain text only (never HTML, never turned into links).
 */
function cleanText(text) {
  return String(text)
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

/** A short single-line preview of a message for the conversation lists. */
function preview(text) {
  const line = String(text).replace(/\s+/g, " ").trim();
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

module.exports = {
  TOPICS,
  LIMITS,
  AUTO_CLOSE_DAYS,
  DELETE_AFTER_CLOSE_DAYS,
  DAY_MS,
  isOfficeOpen,
  nextOpening,
  needsAfterHoursNotice,
  cleanText,
  preview,
};
