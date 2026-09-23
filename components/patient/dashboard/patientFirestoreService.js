// ---------------------------------------------------------------------------
// Data-access layer for the patient dashboard.
//
// fetchMyBookings / fetchAvailableSlots / fetchConsultationHistory read
// live Firestore data — no Blaze/Cloud Functions needed for plain reads,
// only for the two callables below.
//
// requestReschedule / joinVideoCall MUST end up as httpsCallable Cloud
// Functions (see the per-function comments) because the server has to
// re-verify identity itself — an ID or phone number typed in the client
// is never proof of anything on its own (architecture 4.4, 4.5, 9). Since
// Blaze isn't active yet, CLOUD_FUNCTIONS_ENABLED below gates real calls
// vs. a dev-only fallback that mimics the same shape so the rest of the
// app keeps working. Flip it to true the day functions are deployed —
// nothing else in this file, or in Dashboard.jsx/BookingCard, needs to
// change, since the fallback mirrors the real callables' request/response
// shape.
//
// FIELD-NAME ASSUMPTIONS (camelCase, per project convention). None of
// these are confirmed against a written schema doc — they're inferred
// from admin.jsx's existing queries (bookings.paymentStatus,
// bookings.consultationId, bookings.createdAt, bookings.doctorId,
// availableSlots.status/date/startTime/endTime,
// consultationHistory.endedAt) plus best-guess camelCase for the rest.
// If a field comes back undefined at runtime, this is the first place to
// check — grep this file for "ASSUMPTION:" to find every guess.
// ---------------------------------------------------------------------------

import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

import { db, app } from "../../../src/firebase";

// Flip to true once Cloud Functions are deployed (same gate as
// USE_MOCK_BACKEND in bookConsultation.jsx — keep both in sync when you
// flip one).
const CLOUD_FUNCTIONS_ENABLED = false;

// Must match wherever bookConsultation.jsx's FUNCTIONS_REGION points.
const FUNCTIONS_REGION = "europe-west1";

const functions = CLOUD_FUNCTIONS_ENABLED
  ? getFunctions(app, FUNCTIONS_REGION)
  : null;
const callRequestReschedule =
  functions && httpsCallable(functions, "requestReschedule");
const callJoinVideoCall =
  functions && httpsCallable(functions, "startVideoCall");

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

// Firestore Timestamp -> JS Date, passthrough for anything else (mirrors
// the defensive check admin.jsx already does: b.createdAt?.toDate ? ...).
function toDate(value) {
  if (!value) return null;
  return typeof value.toDate === "function" ? value.toDate() : value;
}

// ASSUMPTION: CreateScheduleModal (admin) writes mode as "Online" /
// "In person" (see that file), but the patient-facing booking flow
// (bookConsultation.jsx) and Dashboard.jsx/patientBookingCard compare
// against lowercase "online" / "offline". Normalize once, here, at the
// read boundary, rather than scattering === "Online" checks through the
// patient UI. If a third spelling shows up in Firestore, it falls
// through to "offline" — adjust this map if that's wrong.
function normalizeMode(rawMode) {
  const key = String(rawMode || "")
    .trim()
    .toLowerCase();
  if (key === "online") return "online";
  if (key === "in person" || key === "offline") return "offline";
  return "offline";
}

// ASSUMPTION: bookings docs don't store a `state` field directly — admin
// derives scheduling status itself from paymentStatus + consultationId
// (see Admin's `toSchedule` memo). Dashboard.jsx expects
// booking.state === "pending_assignment" for the "Awaiting assignment"
// tile, so we derive the same shape here instead of duplicating this
// logic a third time in the component.
function deriveBookingState(data) {
  if (data.paymentStatus === "failed") return "payment_failed";
  if (!data.consultationId) return "pending_assignment";
  if (data.callStartedAt) return "in_progress";
  return "scheduled";
}

// ASSUMPTION: doctors collection docs have `name` (used by admin.jsx's
// doctorsQuery) keyed by doc id == doctorId on bookings/slots. Slots and
// bookings are assumed to store doctorId only, not a denormalized
// doctorName, so we join client-side. If doctorName IS already
// denormalized onto these docs, this lookup is redundant but harmless
// (it just won't be used — see the `??` fallback below).
async function fetchDoctorNameMap(doctorIds) {
  const uniqueIds = [...new Set(doctorIds.filter(Boolean))];
  const map = {};
  await Promise.all(
    uniqueIds.map(async (id) => {
      try {
        const snap = await getDoc(doc(db, "doctors", id));
        if (snap.exists()) map[id] = snap.data().name ?? null;
      } catch {
        // Missing/unreadable doctor doc shouldn't break the whole list —
        // the component already falls back to "To be assigned"-style
        // copy when doctorName is null.
      }
    }),
  );
  return map;
}

// ---------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------

// ASSUMPTION: the field linking a booking to its owner is `uid` (not
// `patientUid` / `patientId`) — chosen for consistency with how
// admin.jsx and Firebase Auth conventionally name this field. Security
// Rules should restrict reads to where uid == request.auth.uid (6.1).
export async function fetchMyBookings(patientUid) {
  const bookingsQuery = query(
    collection(db, "bookings"),
    where("uid", "==", patientUid),
    orderBy("createdAt", "desc"),
  );

  const snap = await getDocs(bookingsQuery);
  const rawBookings = snap.docs.map((d) => ({ bookingId: d.id, ...d.data() }));

  const doctorNames = await fetchDoctorNameMap(
    rawBookings.map((b) => b.doctorId),
  );

  return rawBookings.map((b) => ({
    ...b,
    createdAt: toDate(b.createdAt),
    scheduledTime: toDate(b.scheduledTime),
    callStartedAt: b.callStartedAt ? toDate(b.callStartedAt) : null,
    mode: normalizeMode(b.mode),
    doctorName: b.doctorName ?? doctorNames[b.doctorId] ?? null,
    state: deriveBookingState(b),
  }));
}

// Reads open slots created via CreateScheduleModal (admin). Rules should
// allow any authenticated patient to read, but only Cloud Functions to
// write the open -> held -> booked transition (6.1) — this file never
// writes to availableSlots.
export async function fetchAvailableSlots() {
  const slotsQuery = query(
    collection(db, "availableSlots"),
    where("status", "==", "open"),
    orderBy("date", "asc"),
  );

  const snap = await getDocs(slotsQuery);
  const rawSlots = snap.docs.map((d) => ({ slotId: d.id, ...d.data() }));

  const doctorNames = await fetchDoctorNameMap(rawSlots.map((s) => s.doctorId));

  return rawSlots.map((s) => ({
    ...s,
    mode: normalizeMode(s.mode),
    doctorName: s.doctorName ?? doctorNames[s.doctorId] ?? "Unassigned",
  }));
}

// ASSUMPTION: consultationHistory docs (written by markConsultationDone,
// per the architecture doc) carry uid, doctorId (or doctorName), mode,
// startedAt, endedAt — matching admin.jsx's `orderBy("endedAt", "desc")`.
// Only date/time/doctorName/mode are surfaced to the patient by design —
// no location, no other sensitive detail (see original comment on this
// function: the live sensitivePatientDetails doc is already gone by the
// time history exists).
export async function fetchConsultationHistory(uid) {
  const historyQuery = query(
    collection(db, "consultationHistory"),
    where("uid", "==", uid),
    orderBy("endedAt", "desc"),
  );

  const snap = await getDocs(historyQuery);
  const rawHistory = snap.docs.map((d) => ({ historyId: d.id, ...d.data() }));

  const doctorNames = await fetchDoctorNameMap(
    rawHistory.map((h) => h.doctorId),
  );

  return rawHistory.map((h) => ({
    ...h,
    mode: normalizeMode(h.mode),
    doctorName: h.doctorName ?? doctorNames[h.doctorId] ?? null,
    startedAt: toDate(h.startedAt),
    endedAt: toDate(h.endedAt),
  }));
}

// ---------------------------------------------------------------------
// Writes (both go through Cloud Functions once deployed — see the
// CLOUD_FUNCTIONS_ENABLED note at the top of this file)
// ---------------------------------------------------------------------

// TODO(functions): real requestReschedule({ bookingId, consultationId,
// phone, preferredTime, reason }) must re-check BOTH the typed
// consultationId AND the phone number against the authenticated
// account's booking before accepting (4.4, 9) — an ID alone is never
// enough. The dev fallback below only checks the ID, client-side, which
// is NOT secure and exists purely so the dashboard's reschedule UI keeps
// working before functions are deployed. Do not treat the fallback path
// as anything but a placeholder.
export async function requestReschedule({
  booking,
  consultationId,
  preferredTime,
  reason,
}) {
  if (CLOUD_FUNCTIONS_ENABLED) {
    const { data } = await callRequestReschedule({
      bookingId: booking.bookingId,
      consultationId,
      preferredTime,
      reason,
    });
    return data;
  }

  // DEV FALLBACK — client-side check only, not a security boundary.
  if (consultationId.trim().toUpperCase() !== booking.consultationId) {
    const err = new Error(
      "That consultation ID doesn\u2019t match this booking.",
    );
    err.code = "ID_MISMATCH";
    throw err;
  }
  return {
    bookingId: booking.bookingId,
    requested: true,
    preferredTime,
    reason,
  };
}

// TODO(functions): real startVideoCall({ consultationId }) must (1) match
// the typed ID server-side, (2) verify request.auth.uid owns this
// booking, (3) re-check now >= scheduledTime - 5min server-side, and
// (4) return the same Jitsi room name the doctor's client receives,
// setting callStartedAt the first time either side calls this (4.5, 9).
// The dev fallback below is the same non-secure placeholder as above.
export async function joinVideoCall({ booking, enteredConsultationId }) {
  if (CLOUD_FUNCTIONS_ENABLED) {
    const { data } = await callJoinVideoCall({
      consultationId: booking.consultationId,
      enteredConsultationId,
    });
    return data;
  }

  // DEV FALLBACK — client-side check only, not a security boundary.
  if (enteredConsultationId.trim().toUpperCase() !== booking.consultationId) {
    const err = new Error(
      "That consultation ID doesn\u2019t match this booking.",
    );
    err.code = "ID_MISMATCH";
    throw err;
  }
  const now = new Date().toISOString();
  return {
    consultationId: booking.consultationId,
    callStartedAt: now,
    roomName: `mock-room-${booking.consultationId}`,
  };
}
