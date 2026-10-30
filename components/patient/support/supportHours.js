// components/patient/support/supportHours.js
//
// Support topics, limits and office hours as the Help panel shows them.
// The server decides (functions/lib/support.js); keep the two in step by
// hand (functions deploy from functions/ alone).
//
// Office hours: Monday to Friday, 08:00 to 17:00 Ghana time (Africa/Accra
// = UTC, so UTC arithmetic is exact). Public holidays aren't known.

export const SUPPORT_TOPICS = {
  booking: "Booking or appointment time",
  payment: "Payment or refund",
  video_call: "Joining a video call",
  prescription: "Prescription",
  account: "My account",
  other: "Something else",
};

export const MESSAGE_MAX = 2000;
export const MESSAGES_PER_THREAD = 60;
export const OFFICE_HOURS_TEXT = "Monday to Friday, 8:00 am to 5:00 pm";

const OPEN_HOUR = 8;
const CLOSE_HOUR = 17;
const isWeekday = (d) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5;

export function isOfficeOpen(date) {
  const h = date.getUTCHours();
  return isWeekday(date) && h >= OPEN_HOUR && h < CLOSE_HOUR;
}

/** When the office next opens (`date` itself if it's open now). */
export function nextOpening(date) {
  if (isOfficeOpen(date)) return date;
  const d = new Date(date);
  if (d.getUTCHours() >= OPEN_HOUR) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(OPEN_HOUR, 0, 0, 0);
  while (!isWeekday(d)) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** "today at 8:00 am" / "tomorrow at 8:00 am" / "on Monday at 8:00 am". */
export function openingPhrase(opensAt, now) {
  const day = (d) => Math.floor(d.getTime() / 86400000);
  const diff = day(opensAt) - day(now);
  const when =
    diff === 0
      ? "today"
      : diff === 1
        ? "tomorrow"
        : `on ${opensAt.toLocaleDateString("en-GB", { timeZone: "Africa/Accra", weekday: "long" })}`;
  return `${when} at 8:00 am`;
}
