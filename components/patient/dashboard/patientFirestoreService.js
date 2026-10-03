// ---------------------------------------------------------------------------
// Data-access layer for the patient dashboard.
//
// Reads go straight to Firestore; Security Rules only return the signed-in
// patient's own bookings and history, and open slots. Every write goes
// through a Cloud Function, which re-checks ownership and the typed
// consultation ID on the server.
// ---------------------------------------------------------------------------

import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db, functions } from "../../../src/firebase";
import { toDate } from "../../../src/constants";

const callRequestReschedule = httpsCallable(functions, "requestReschedule");
const callStartVideoCall = httpsCallable(functions, "startVideoCall");
const callGetBookingStatus = httpsCallable(functions, "getBookingStatus");

/** Re-checks every payment attempt on a booking with Paystack. */
export async function checkPaymentStatus(bookingId) {
  const { data } = await callGetBookingStatus({ bookingId });
  return data; // { status: "confirmed" | "pending" | "failed", message? }
}

// Dashboard display state, derived from the stored booking status.
//   awaiting_payment -> "awaiting_payment" (draft; deleted if never paid)
//   paid             -> "pending_assignment"
//   scheduled        -> "scheduled" / "in_progress"
function displayState(b) {
  if (b.status === "awaiting_payment") return "awaiting_payment";
  if (b.status === "paid") return "pending_assignment";
  if (b.callStartedAt) return "in_progress";
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
export async function fetchConsultationHistory(patientUid) {
  const snap = await getDocs(
    query(
      collection(db, "consultationHistory"),
      where("patientUid", "==", patientUid),
      orderBy("endedAt", "desc"),
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

export async function requestReschedule({ booking, consultationId, preferredTime, reason }) {
  const { data } = await callRequestReschedule({
    bookingId: booking.bookingId,
    consultationId: consultationId.trim().toUpperCase(),
    preferredTime,
    reason,
  });
  return data;
}

/** Server checks the typed ID, ownership, time window and opens the call. */
export async function joinVideoCall({ booking, enteredConsultationId }) {
  const { data } = await callStartVideoCall({
    consultationId: booking.consultationId,
    enteredConsultationId: enteredConsultationId.trim().toUpperCase(),
  });
  return data;
}
