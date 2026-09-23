// ---------------------------------------------------------------------------
// Data-access layer for the doctor dashboard.
//
// Real Firestore/Cloud Functions/Storage implementations, replacing the
// mock-data placeholders. Signatures are unchanged from the mock version,
// so nothing in this folder's components needs to change beyond what's
// noted inline.
//
// DEPENDENCIES NOT YET IN PLACE:
//   - startVideoCall / markConsultationDone call Cloud Functions
//     (functions/startVideoCall.js, functions/markConsultationDone.js —
//     written alongside this file) that must be deployed, which needs the
//     Blaze plan.
//   - uploadDoctorProfilePicture writes to Cloud Storage, which also
//     needs Blaze.
//   - fetchAssignedConsultations relies on Firestore Security Rules
//     checking request.auth.uid against consultations.doctorId (6.1),
//     which means it needs a real signed-in Firebase Auth user — the
//     current currentDoctor.uid in docMockData.js is a placeholder, not
//     an auth identity, and reads will fail once rules are deployed
//     until real doctor auth is wired in.
// ---------------------------------------------------------------------------

import { db, functions } from "../../src/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

// Live query, joined client-side with the matching `bookings` doc
// (type/mode/patient/rescheduleHistory) and, where this doctor is the
// assigned doctorId, the matching `sensitivePatientDetails` doc —
// Firestore Security Rules should restrict that last read to
// request.auth.uid === consultation.doctorId (see 6.1).
//
// One-shot getDocs() for now, not onSnapshot() — matches the previous
// mock's calling contract in DoctorDashboard.jsx (a single .then()).
// Worth revisiting for onSnapshot() later so newly-issued consultation
// IDs and reschedules show up without a manual refresh.
//
// IMPORTANT: amountPaid/payment fields are deliberately left out of the
// returned shape — that data belongs to the admin/revenue view only,
// never the doctor-facing one.
export async function fetchAssignedConsultations(doctorUid) {
  const consultationsQuery = query(
    collection(db, "consultations"),
    where("doctorId", "==", doctorUid),
    where("status", "==", "active"),
  );
  const consultationsSnap = await getDocs(consultationsQuery);

  return Promise.all(
    consultationsSnap.docs.map(async (consultationDoc) => {
      const consultationId = consultationDoc.id;
      const consultation = consultationDoc.data();

      const [bookingSnap, sensitiveSnap] = await Promise.all([
        getDoc(doc(db, "bookings", consultation.bookingId)),
        getDoc(doc(db, "sensitivePatientDetails", consultationId)),
      ]);
      const booking = bookingSnap.exists() ? bookingSnap.data() : {};
      const sensitiveDetails = sensitiveSnap.exists()
        ? sensitiveSnap.data()
        : {};

      return {
        consultationId,
        bookingId: consultation.bookingId,
        doctorId: consultation.doctorId,
        type: booking.type,
        mode: booking.mode,
        scheduledTime: consultation.scheduledTime,
        status: consultation.status,
        callStartedAt: consultation.callStartedAt ?? null,
        patient: booking.patient,
        sensitiveDetails,
        rescheduleHistory: booking.rescheduleHistory ?? [],
      };
    }),
  );
}

// Calls the startVideoCall Cloud Function, which (see
// functions/startVideoCall.js):
//   1. Verifies request.auth.uid === consultations.doctorId for this doc.
//   2. Re-checks server-side that now >= scheduledTime - 5min — the
//      5-minute lock in the UI is a convenience, not the enforcement point.
//   3. Sets consultations.callStartedAt the *first* time this is called
//      (never overwrites it on rejoin).
//   4. Returns a server-derived room name — never construct this from the
//      raw consultationId on the client.
//
// Requires functions/startVideoCall.js to be deployed (Blaze plan).
export async function startVideoCall(consultationId) {
  const callStartVideoCall = httpsCallable(functions, "startVideoCall");
  const result = await callStartVideoCall({ consultationId });
  return result.data;
}

// Calls the markConsultationDone Cloud Function, which (see
// functions/markConsultationDone.js) runs a single transaction that (4.4,
// 4.6, 4.9):
//   1. Re-checks request.auth.uid === consultations.doctorId for an online
//      consultation (in-person also allows an admin — not yet implemented
//      server-side, see that function's own comment).
//   2. Writes the anonymised metrics record (no patient identifiers).
//   3. Writes outcome + (for No-show) forfeitAmount/refundOwed onto a
//      permanent referenceLedger entry, computed server-side from the
//      booking's amountPaid — the client never sends an amount.
//   4. Permanently deletes the `bookings`, `consultations`, and
//      `sensitivePatientDetails` documents for this session.
//
// Requires functions/markConsultationDone.js to be deployed (Blaze plan).
export async function markConsultationDone({ consultationId, outcome }) {
  const callMarkDone = httpsCallable(functions, "markConsultationDone");
  const result = await callMarkDone({ consultationId, outcome });
  return result.data;
}

// ---------------------------------------------------------------------------
// Doctor public profile — powers the "My profile" tab and, from there, the
// "Meet your doctors" section on the patient-facing landing page.
// ---------------------------------------------------------------------------

// Security Rules should allow `read: if true` on doctorProfiles (it's what
// the public landing page's "Meet your doctors" section queries), while
// restricting `write` to request.auth.uid === doctorUid.
export async function fetchDoctorProfile(doctorUid) {
  const snap = await getDoc(doc(db, "doctorProfiles", doctorUid));
  return snap.exists() ? snap.data() : null;
}

// setDoc(..., { merge: true }) rather than update() so a doctor's first
// edit (no existing doc yet) still succeeds. Re-validate on the server
// too, not just in ProfileTab.jsx's UI: Security Rules should cap `bio`
// length and the size of `specialties`/`languages`, and reject a write
// that sets `doctorId` to anyone other than request.auth.uid.
export async function updateDoctorProfile(doctorUid, updates) {
  const profileRef = doc(db, "doctorProfiles", doctorUid);
  await setDoc(
    profileRef,
    { ...updates, doctorId: doctorUid, updatedAt: serverTimestamp() },
    { merge: true },
  );
  const snap = await getDoc(profileRef);
  return snap.data();
}

// Uploads to Cloud Storage at doctorProfilePictures/{doctorUid}/profile.jpg,
// overwriting any previous file at that path. `imageBlob` is expected to
// already be resized client-side (see resizeProfilePhoto() in utils.js) —
// don't pass a full-resolution original. Storage Rules should mirror the
// Firestore pattern: only request.auth.uid === doctorUid may write to that
// path, and should re-check content type and a size ceiling (e.g. 1MB) as
// a second line of defense behind validateProfilePhoto() in utils.js.
//
// Requires the Blaze plan (Cloud Storage needs billing enabled).
export async function uploadDoctorProfilePicture(doctorUid, imageBlob) {
  const storage = getStorage();
  const fileRef = storageRef(
    storage,
    `doctorProfilePictures/${doctorUid}/profile.jpg`,
  );
  await uploadBytes(fileRef, imageBlob, { contentType: "image/jpeg" });
  const photoURL = await getDownloadURL(fileRef);
  return { photoURL };
}
