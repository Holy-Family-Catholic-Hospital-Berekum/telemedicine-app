// When a patient's own reschedule costs money (used by rescheduleForm.jsx).

// Mirrors rescheduleCountsAsNoShow (functions/lib/consultationLifecycle.js):
// a patient asking for a new time while the doctor is waiting for them in
// the video room (or after the start of a hospital visit) pays the no-show
// fee. Only for the wording; the server decides.
export function isLate(booking, now = Date.now()) {
  const start = booking.scheduledTime?.getTime?.();
  if (!start || now < start || booking.metAt) return false;
  if (booking.rescheduleRequest?.status === "requested") return false;
  if (booking.mode === "online") return booking.waitDeadline?.for === "patient";
  return true;
}

// Mirrors rescheduleNeedsLateFee (functions/lib/consultationLifecycle.js):
// free up to 24 hours before the start; after that, until the start, the
// reschedule fee. The appointment stays booked until it's paid. A time
// given less than 24 hours ahead is free to change for its first hour.
export const FREE_RESCHEDULE_HOURS = 24;
const SHORT_NOTICE_FREE_MINUTES = 60;
export function freeChangeUntil(booking) {
  const start = booking.scheduledTime?.getTime?.();
  const setAt = booking.scheduleSetAt?.getTime?.();
  if (!start || !setAt || start - setAt >= FREE_RESCHEDULE_HOURS * 3600 * 1000) return null;
  return new Date(setAt + SHORT_NOTICE_FREE_MINUTES * 60 * 1000);
}
export function inFreeHour(booking, now = Date.now()) {
  const until = freeChangeUntil(booking);
  return Boolean(until) && now < until.getTime();
}
export function needsLateFee(booking, now = Date.now()) {
  const start = booking.scheduledTime?.getTime?.();
  if (!start || now >= start || booking.metAt) return false;
  if (booking.payAtHospital || booking.doctorUnavailable) return false;
  if (booking.rescheduleRequest?.status === "requested") return false;
  if (inFreeHour(booking, now)) return false;
  return start - now < FREE_RESCHEDULE_HOURS * 3600 * 1000;
}
