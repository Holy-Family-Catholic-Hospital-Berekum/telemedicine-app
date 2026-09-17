// ---------------------------------------------------------------------------
// Data-access layer for the doctor dashboard.
//
// Every function below is a placeholder implementation over local mock data.
// Each one documents exactly what it should become per the architecture doc
// (Telemedicine_System_Architecture_Final_Rev3). Swap the body, keep the
// signature, and the components in this folder don't need to change.
// ---------------------------------------------------------------------------

import {
  mockConsultations,
  mockDoctorProfile,
  FORFEIT_PERCENTAGE,
} from "./docMockData";

const MOCK_LATENCY_MS = 350;

function delay(value) {
  return new Promise((resolve) =>
    setTimeout(() => resolve(value), MOCK_LATENCY_MS),
  );
}

// TODO(firestore): replace with a live query, e.g.
//   query(collection(db, 'consultations'),
//         where('doctorId', '==', doctorUid),
//         where('status', '==', 'active'))
// joined with the matching `bookings` doc (type/mode) and, where this doctor
// is the assigned doctorId, the matching `sensitivePatientDetails` doc
// (Firestore Security Rules already restrict that read to
// request.auth.uid === consultation.doctorId — see 6.1).
// IMPORTANT: never fetch or return `amountPaid`/payment fields into this
// doctor-facing view — that data belongs to the admin/revenue view only.
// Consider onSnapshot() instead of a one-shot get() so newly-issued
// consultation IDs and reschedules appear live.
export async function fetchAssignedConsultations(doctorUid) {
  const assigned = mockConsultations.filter(
    (c) => c.doctorId === doctorUid && c.status === "active",
  );
  return delay(assigned);
}

// TODO(firestore): this should call an httpsCallable Cloud Function, e.g.
// `startVideoCall({ consultationId })`, which must:
//   1. Verify request.auth.uid === consultations.doctorId for this doc.
//   2. Re-check server-side that now >= scheduledTime - 5min before
//      returning a room — the 5-minute lock in the UI is a convenience,
//      not the enforcement point.
//   3. Set consultations.callStartedAt = serverTimestamp() the *first* time
//      this is called (never overwrite it on rejoin).
//   4. Return the Jitsi room name, derived server-side — never construct
//      this from the raw consultationId on the client.
export async function startVideoCall(consultationId) {
  const now = new Date().toISOString();
  return delay({
    consultationId,
    callStartedAt: now,
    roomName: `mock-room-${consultationId}`,
  });
}

// TODO(firestore): this should call an httpsCallable Cloud Function, e.g.
// `markConsultationDone({ consultationId, outcome })`, which runs a single
// transaction that (4.4, 4.6, 4.9):
//   1. Re-checks request.auth.uid === consultations.doctorId for an online
//      consultation (in-person also allows an admin, with confirmation).
//   2. Writes the anonymised metrics record (no patient identifiers).
//   3. Writes outcome + (for No-show) forfeitAmount/refundOwed onto the
//      permanent referenceLedger entry for this booking — this must land
//      before step 4, since the amount can't be reconstructed afterward.
//      This money math happens entirely server-side; the doctor client
//      passes only { consultationId, outcome }, never an amount.
//   4. Permanently deletes the `bookings`, `consultations`, and
//      `sensitivePatientDetails` documents for this session, and expires
//      the consultation ID.
// There is no undo once this succeeds — the confirming UI must make that
// unmistakable before calling this.
export async function markConsultationDone({
  consultationId,
  outcome,
  amountPaid,
}) {
  let forfeitAmount = 0;
  let refundOwed = 0;
  if (outcome === "No-show") {
    forfeitAmount = Math.round(amountPaid * FORFEIT_PERCENTAGE * 100) / 100;
    refundOwed = Math.round((amountPaid - forfeitAmount) * 100) / 100;
  }
  // Returned for the admin/revenue view and internal bookkeeping only —
  // doctor-facing components must not read forfeitAmount/refundOwed off
  // this result.
  return delay({ consultationId, outcome, forfeitAmount, refundOwed });
}

// ---------------------------------------------------------------------------
// Doctor public profile (new — powers the "My profile" tab and, from there,
// the "Meet your doctors" section on the patient-facing landing page).
//
// This is deliberately its own collection, not a field on `adminUsers`:
// `adminUsers` (6.1) is an access-control list checked by Security Rules
// and Cloud Functions, and shouldn't also be the thing a public landing
// page queries. `doctorProfiles` holds only public-safe display content —
// nothing from `sensitivePatientDetails`, and nothing session/auth-related.
// ---------------------------------------------------------------------------

// TODO(firestore): read `doctorProfiles/{doctorUid}`. Security Rules should
// allow `read: if true` on this collection — it's what the public landing
// page's "Meet your doctors" section queries — while restricting `write` to
// `request.auth.uid === doctorUid`, the same owner-only pattern as 6.1.
export async function fetchDoctorProfile(doctorUid) {
  const profile =
    mockDoctorProfile.doctorId === doctorUid ? mockDoctorProfile : null;
  return delay(profile);
}

// TODO(firestore): setDoc(doc(db, 'doctorProfiles', doctorUid), updates,
// { merge: true }), guarded by the Security Rule above. Re-validate on the
// server too, not just in ProfileTab.jsx's UI: cap `bio` length and the
// size of the `specialties`/`languages` arrays, and reject unexpected
// fields (a doctor's own write should never be able to set `doctorId` to
// someone else's uid).
export async function updateDoctorProfile(doctorUid, updates) {
  const next = {
    ...mockDoctorProfile,
    ...updates,
    doctorId: doctorUid,
    updatedAt: new Date().toISOString(),
  };
  return delay(next);
}

// TODO(storage): upload `imageBlob` — already resized client-side, see
// resizeProfilePhoto() in utils.js; don't send a full-resolution original —
// to Cloud Storage at `doctorProfilePictures/{doctorUid}/profile.jpg`,
// overwriting any previous file at that path. Storage Rules should mirror
// the Firestore pattern: only `request.auth.uid === doctorUid` may write to
// that path, and rules should re-check content type and a size ceiling
// (e.g. 1MB, since the client already downscaled it) as a second line of
// defense behind validateProfilePhoto() in utils.js. Once uploaded, take
// the resulting getDownloadURL() and pass it into updateDoctorProfile()
// above so `photoURL` is set on the Firestore doc — don't leave the new
// photo living only in Storage with nothing pointing at it. If the 480px
// version this uploads ever proves too heavy for the landing page's grid,
// an onFinalize Storage trigger could generate a smaller thumbnail instead
// of resizing again on the client.
export async function uploadDoctorProfilePicture(doctorUid, imageBlob) {
  const objectUrl = URL.createObjectURL(imageBlob);
  return delay({ photoURL: objectUrl });
}
