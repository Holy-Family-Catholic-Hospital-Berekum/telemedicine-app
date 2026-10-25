import { CALL_UNLOCK_MINUTES, CALL_CLOSES_HOURS } from "../../../src/constants.js";

const UNLOCK_WINDOW_MS = CALL_UNLOCK_MINUTES * 60 * 1000;
const CLOSE_AFTER_MS = CALL_CLOSES_HOURS * 3600 * 1000;

// Same rule as the doctor dashboard: the video room opens
// CALL_UNLOCK_MINUTES before the scheduled time and closes
// CALL_CLOSES_HOURS after it (server enforces both). `closed` also marks
// when an in-person appointment time is well past.
export function getCallWindow(scheduledTime, now = new Date()) {
  const scheduledMs = new Date(scheduledTime).getTime();
  const unlockAtMs = scheduledMs - UNLOCK_WINDOW_MS;
  const nowMs = now.getTime();
  const unlocked = nowMs >= unlockAtMs;
  const closed = nowMs > scheduledMs + CLOSE_AFTER_MS;
  const minutesUntilUnlock = unlocked ? 0 : Math.ceil((unlockAtMs - nowMs) / 60000);
  return { unlocked, closed, minutesUntilUnlock };
}

// Dashboard display state, derived from the stored booking status.
//   awaiting_payment -> "awaiting_payment" (draft; deleted if never paid)
//   paid             -> "pending_assignment"
//   scheduled        -> "scheduled", or "in_progress" once the patient
//                       has joined the call
//   no_show          -> "no_show" (missed; held for a paid reschedule or a
//                       refund until noShowExpiresAt)
export function displayState(b) {
  if (b.status === "awaiting_payment") return "awaiting_payment";
  if (b.status === "paid") return "pending_assignment";
  if (b.status === "no_show") return "no_show";
  if (b.patientJoinedAt) return "in_progress";
  return "scheduled";
}

const byScheduledTime = (a, b) =>
  (a.scheduledTime?.getTime?.() ?? 0) - (b.scheduledTime?.getTime?.() ?? 0);

/** The dashboard's booking groups (by display state), most important first. */
export function groupBookings(bookings) {
  return {
    scheduled: bookings
      .filter((b) => b.state === "scheduled" || b.state === "in_progress")
      .sort(byScheduledTime),
    missed: bookings.filter((b) => b.state === "no_show"),
    waiting: bookings.filter((b) => b.state === "pending_assignment"),
  };
}

// No confirmed payment, no booking: an unpaid attempt is never shown as a
// booking, only as a payment being checked (the patient tapped Pay and a
// prompt may still go through).
export function paymentsInProgress(bookings) {
  return bookings.filter(
    (b) => b.state === "awaiting_payment" && (b.txRefs?.length ?? 0) > 0,
  );
}

/**
 * Video calls the patient has been in that they can go back into: still
 * scheduled (not missed), the doctor not marked as unable to come, and the
 * room still open. Same rule as the booking card's own Rejoin button.
 */
export function liveBookings(bookings, now = new Date()) {
  return bookings.filter(
    (booking) =>
      booking.mode === "online" &&
      booking.state === "in_progress" &&
      !booking.doctorUnavailable &&
      !getCallWindow(booking.scheduledTime, now).closed,
  );
}

/**
 * The booking page for an open slot (Home and the dashboard): the slot
 * fixes type, mode and doctor, which bookConsultation.jsx reads from the
 * link and then checks against the slot itself.
 */
export function slotBookingPath(slot) {
  const params = new URLSearchParams({
    slotId: slot.slotId,
    type: slot.type,
    mode: slot.mode,
  });
  if (slot.doctorUid) params.set("doctor", slot.doctorUid);
  return `/book?${params.toString()}`;
}

/** "GHS 150.00" (booking cards). */
export function formatCurrency(amount) {
  return `GHS ${Number(amount ?? 0).toFixed(2)}`;
}

/** "GHS 150", "GHS 7.50" (fees and refunds: no ".00" on whole cedis). */
export function formatGhs(amount) {
  return `GHS ${Number(amount || 0).toFixed(2).replace(/\.00$/, "")}`;
}