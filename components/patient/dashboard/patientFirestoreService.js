// ---------------------------------------------------------------------------
// Data-access layer for the patient dashboard.
//
// Reads go straight to Firestore; Security Rules only return the signed-in
// patient's own bookings and history, and open slots. Every write goes
// through a Cloud Function, which re-checks ownership on the server.
// ---------------------------------------------------------------------------

import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  limit,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db, functions } from "../../../src/firebase";
import { toDate } from "../../../src/constants";

const callRequestReschedule = httpsCallable(functions, "requestReschedule");
const callStartVideoCall = httpsCallable(functions, "startVideoCall");
const callGetBookingStatus = httpsCallable(functions, "getBookingStatus");
const callRequestRefund = httpsCallable(functions, "requestRefund");
const callStartNoShowReschedule = httpsCallable(functions, "startNoShowReschedule");
const callGetNoShowFeeStatus = httpsCallable(functions, "getNoShowFeeStatus");

/** The patient's refund requests, keyed by consultationId. */
export async function fetchMyRefundRequests(patientUid) {
  const snap = await getDocs(
    query(collection(db, "refundRequests"), where("patientUid", "==", patientUid)),
  );
  return Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
}

/** source: "history" | "booking"; id: consultationId | bookingId */
export async function requestRefund({ source, id, reason, refundPhone }) {
  const { data } = await callRequestRefund({ source, id, reason, refundPhone });
  return data;
}

/** Re-checks every payment attempt on a booking with Paystack. */
export async function checkPaymentStatus(bookingId) {
  const { data } = await callGetBookingStatus({ bookingId });
  return data; // { status: "confirmed" | "pending" | "failed", message? }
}

// Dashboard display state, derived from the stored booking status.
//   awaiting_payment -> "awaiting_payment" (draft; deleted if never paid)
//   paid             -> "pending_assignment"
//   scheduled        -> "scheduled", or "in_progress" once the patient
//                       has joined the call
//   no_show          -> "no_show" (missed; held for a paid reschedule or a
//                       refund until noShowExpiresAt)
function displayState(b) {
  if (b.status === "awaiting_payment") return "awaiting_payment";
  if (b.status === "paid") return "pending_assignment";
  if (b.status === "no_show") return "no_show";
  if (b.patientJoinedAt) return "in_progress";
  return "scheduled";
}

// ---------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------

export async function fetchMyBookings(patientUid) {
  const snap = await getDocs(
    query(
      collection(db, "bookings"),
      where("patientUid", "==", patientUid),
      orderBy("createdAt", "desc"),
    ),
  );
  return snap.docs.map((d) => {
    const b = d.data();
    return {
      ...b,
      bookingId: d.id,
      createdAt: toDate(b.createdAt),
      scheduledTime: toDate(b.scheduledTime),
      callStartedAt: toDate(b.callStartedAt),
      patientJoinedAt: toDate(b.patientJoinedAt),
      doctorJoinedAt: toDate(b.doctorJoinedAt),
      noShowAt: toDate(b.noShowAt),
      // The two were connected in the video call: it has taken place.
      metAt: toDate(b.metAt),
      // The shared countdown: whose turn it is to be in the room, by when.
      waitDeadline: b.waitDeadline?.for
        ? { for: b.waitDeadline.for, at: toDate(b.waitDeadline.at) }
        : null,
      noShowExpiresAt: toDate(b.noShowExpiresAt),
      state: displayState(b),
    };
  });
}

/** Open slots that haven't started yet. */
export async function fetchAvailableSlots() {
  const snap = await getDocs(
    query(
      collection(db, "availableSlots"),
      where("status", "==", "open"),
      orderBy("startAt", "asc"),
    ),
  );
  const now = Date.now();
  return snap.docs
    .map((d) => ({ ...d.data(), slotId: d.id, startAt: toDate(d.data().startAt) }))
    .filter((s) => s.startAt && s.startAt.getTime() > now);
}

/**
 * Closed consultations. Holds only doctor, times, type/mode, outcome and
 * amount: the personal details are deleted when a consultation closes.
 */
export const HISTORY_STEP = 50;

/** The patient's latest `max` closed consultations (newest first). */
export async function fetchConsultationHistory(patientUid, max = HISTORY_STEP) {
  const snap = await getDocs(
    query(
      collection(db, "consultationHistory"),
      where("patientUid", "==", patientUid),
      orderBy("endedAt", "desc"),
      limit(max),
    ),
  );
  return snap.docs.map((d) => {
    const h = d.data();
    return {
      id: d.id,
      doctorName: h.doctorName,
      type: h.type,
      mode: h.mode,
      outcome: h.outcome,
      patientJoined: h.patientJoined === true,
      refundClosed: h.refundClosed === true,
      scheduledTime: toDate(h.scheduledTime),
      startedAt: toDate(h.startedAt),
      endedAt: toDate(h.endedAt),
      amountPaid: h.amountPaid,
      currency: h.currency || "GHS",
    };
  });
}

// ---------------------------------------------------------------------
// Writes (Cloud Functions)
// ---------------------------------------------------------------------

export async function requestReschedule({ booking, preferredTime, reason }) {
  const { data } = await callRequestReschedule({
    bookingId: booking.bookingId,
    preferredTime,
    reason,
  });
  return data;
}

/**
 * A missed (no-show) booking: ask for a new time. Resolves
 * { status: "requested" } (no fee, or already paid) or
 * { status: "pay", reference, amount, currency, customer } for the
 * Paystack popup.
 */
export async function startNoShowReschedule({ bookingId, preferredTime, reason }) {
  const { data } = await callStartNoShowReschedule({ bookingId, preferredTime, reason });
  return data;
}

/** Asks the server (which re-checks Paystack) whether the no-show fee arrived. */
export async function getNoShowFeeStatus(bookingId) {
  const { data } = await callGetNoShowFeeStatus({ bookingId });
  return data; // { status: "confirmed" | "pending" | "failed" }
}

/** Server checks ownership and the time window, then opens the call. */
export async function joinVideoCall({ booking, callConsentVersion }) {
  const { data } = await callStartVideoCall({
    consultationId: booking.consultationId,
    ...(callConsentVersion ? { callConsentVersion } : {}),
  });
  return data;
}
