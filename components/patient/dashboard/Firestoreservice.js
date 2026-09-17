// ---------------------------------------------------------------------------
// Data-access layer for the patient dashboard.
//
// Every function below is a placeholder implementation over local mock data.
// Each one documents exactly what it should become per the architecture doc
// (Telemedicine_System_Architecture_Final_Rev3). Swap the body, keep the
// signature, and the components in this folder don't need to change.
// ---------------------------------------------------------------------------

import { mockBookings, mockAvailableSlots } from './Mockdata';

const MOCK_LATENCY_MS = 350;

function delay(value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), MOCK_LATENCY_MS));
}

function generateReferenceCode() {
  return `REF-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

// TODO(firestore): replace with a live query, e.g.
//   query(collection(db, 'bookings'), where('uid', '==', patientUid))
// joined with each booking's `consultations` doc (once scheduled) for
// doctorId/scheduledTime/callStartedAt, and the matching `referenceLedger`
// doc for state. Security Rules already restrict a patient to their own
// bookings only (6.1) — this mock just mirrors that shape.
// Remember: once a session is marked done, its booking/consultation docs
// are permanently erased (4.6) — there is no "past visits" list to fetch.
export async function fetchMyBookings(patientUid) {
  return delay(mockBookings.filter(() => true)); // mock: uid filtering not needed on static data
}

// TODO(firestore): replace with a live query on availableSlots where
// status == 'open' (4.8). Reads are open to any authenticated patient;
// writes (open→held→booked) are Cloud-Function-only (6.1).
export async function fetchAvailableSlots() {
  return delay(mockAvailableSlots);
}

// TODO(firestore): this should call an httpsCallable Cloud Function, e.g.
// `createBooking({ type, mode, dateOfBirth, sex, slotId })`, which must:
//   1. Run the abuse check (too many pending bookings from this account —
//      4.2).
//   2. Create a new `available` entry in referenceLedger and return its
//      code — the code itself is the document ID, so uniqueness is free
//      (4.3).
//   3. Write `dateOfBirth`/`sex` into a separate sensitivePatientDetails
//      doc, never onto the booking doc itself (5, 6.1, 6.5).
//   4. If `slotId` is present, only *record* which slot this booking
//      intends to claim — the slot itself does not move to held until
//      payment is actually submitted (4.8). Do not hold it here.
// The client never writes directly to referenceLedger or availableSlots.
export async function createBooking({ type, mode, dateOfBirth, sex, slot }) {
  const booking = {
    bookingId: `bk_${Math.random().toString(36).slice(2, 8)}`,
    referenceCode: generateReferenceCode(),
    type,
    mode,
    amount: undefined, // filled in by caller from PRICING — server would set this from its own config
    state: 'awaiting_payment',
    expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    slotId: slot?.slotId ?? null,
    // dateOfBirth/sex intentionally not echoed back into this object —
    // in the real flow they never leave the sensitivePatientDetails write.
  };
  return delay(booking);
}

// TODO(firestore): this should call an httpsCallable Cloud Function, e.g.
// `submitPayment({ bookingId, momoName, momoReference, amount })`, which
// runs the atomic check-and-claim transaction (4.3):
//   1. Reject if this reference code is already confirmed (log the
//      attempt to auditLog with a server timestamp either way).
//   2. Reject if `momoReference` was already used on a different confirmed
//      booking.
//   3. Move the referenceLedger entry to `pending`.
//   4. If this booking came from a slot, move that slot from open to held
//      in the SAME transaction (4.8) — that's what closes the double-claim
//      race window, not two separate writes.
// The client never sets paymentStatus or a ledger/slot state directly (6.1,
// 6.3) — this call only ever *requests* the transition.
export async function submitPayment({ bookingId, momoName, momoReference }) {
  return delay({ bookingId, momoName, momoReference, state: 'pending_verification' });
}

// TODO(firestore): this should call an httpsCallable Cloud Function, e.g.
// `requestReschedule({ bookingId, consultationId, phone, preferredTime,
// reason })`, which must re-check both the typed consultationId AND the
// phone number against the account on file before accepting the request —
// an ID alone is never enough to change someone else's booking (4.4, 9).
// This mock just checks the ID against the booking passed in; the real
// phone check happens server-side against the authenticated account, not
// against a value the client could spoof.
export async function requestReschedule({ booking, consultationId, preferredTime, reason }) {
  if (consultationId.trim().toUpperCase() !== booking.consultationId) {
    const err = new Error('That consultation ID doesn\u2019t match this booking.');
    err.code = 'ID_MISMATCH';
    throw err;
  }
  return delay({ bookingId: booking.bookingId, requested: true, preferredTime, reason });
}

// TODO(firestore): this should call an httpsCallable Cloud Function, e.g.
// `startVideoCall({ consultationId })` — the SAME function the doctor
// dashboard calls. It must:
//   1. Verify the typed consultationId matches this booking's assigned ID
//      (never trust a value only checked client-side, as this mock does).
//   2. Verify request.auth.uid is the patient on that booking.
//   3. Re-check server-side that now >= scheduledTime - 5min.
//   4. Return the same Jitsi room name the doctor's client receives, and
//      set callStartedAt the first time either side calls this.
// A typed name is never accepted as identity proof — only the account +
// the correct ID together unlock the room (4.5, 9).
export async function joinVideoCall({ booking, enteredConsultationId }) {
  if (enteredConsultationId.trim().toUpperCase() !== booking.consultationId) {
    const err = new Error('That consultation ID doesn\u2019t match this booking.');
    err.code = 'ID_MISMATCH';
    throw err;
  }
  const now = new Date().toISOString();
  return delay({ consultationId: booking.consultationId, callStartedAt: now, roomName: `mock-room-${booking.consultationId}` });
}