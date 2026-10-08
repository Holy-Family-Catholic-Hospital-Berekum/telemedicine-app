// ---------------------------------------------------------------------------
// Data-access layer for the doctor dashboard.
//
// Reads: the doctor's own consultations (Security Rules return only those
// where doctorUid == the signed-in doctor) and their public profile.
// Writes: calls and closing go through Cloud Functions; the profile is a
// direct write limited by rules to the doctor's own presentational fields.
// Doctors never see payment data or recordings.
// ---------------------------------------------------------------------------

import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

import { db, functions } from "../../src/firebase";
import { storage } from "../../src/firebaseStorage";
import { toDate } from "../../src/constants";
import { getRoomDevice } from "../../src/roomDevice";

const callStartVideoCall = httpsCallable(functions, "startVideoCall");
const callMarkDone = httpsCallable(functions, "markConsultationDone");
const callReportUnavailable = httpsCallable(functions, "reportDoctorUnavailable");

export async function fetchAssignedConsultations(doctorUid) {
  const snap = await getDocs(
    query(
      collection(db, "consultations"),
      where("doctorUid", "==", doctorUid),
      where("status", "in", ["scheduled", "in_progress"]),
      orderBy("scheduledTime", "asc"),
    ),
  );
  // One the doctor couldn't make waits for the hospital to give it a new
  // time; it's off the doctor's list until then.
  return snap.docs.filter((d) => !d.data().doctorUnavailable).map((d) => {
    const c = d.data();
    return {
      consultationId: d.id,
      type: c.type,
      mode: c.mode,
      status: c.status,
      scheduledTime: toDate(c.scheduledTime),
      callStartedAt: toDate(c.callStartedAt),
      patientJoined: Boolean(c.patientFirstJoinedAt),
      doctorJoined: Boolean(c.doctorFirstJoinedAt),
      patient: {
        name: c.patientName || "Patient",
        // Set when the patient is a child booked by a parent or guardian.
        guardianName: c.guardianName || null,
        location: c.patientDetails?.location || "",
      },
      sensitiveDetails: {
        dateOfBirth: c.patientDetails?.dateOfBirth || null,
        sex: c.patientDetails?.sex || null,
      },
      rescheduleHistory: (c.rescheduleHistory || []).map((r) => ({
        from: toDate(r.from),
        to: toDate(r.to),
        reason: r.reason || "",
      })),
    };
  });
}

/**
 * Sends this browser's telemedicine room key (src/roomDevice.js). The
 * server checks the key, that this doctor is assigned, the mode and the
 * time window, then opens (or resets) the signalling room.
 * Resolves: { consultationId, callStartedAt, recordingEnabled }
 */
export async function startVideoCall(consultationId) {
  const device = getRoomDevice();
  const { data } = await callStartVideoCall({
    consultationId,
    ...(device ? { roomDevice: { id: device.id, key: device.key } } : {}),
  });
  return data;
}

/**
 * outcome: "completed", or "no_show" for a hospital visit (video calls are
 * marked automatically). Closes the consultation and deletes the booking
 * details; the amount and any refund are worked out on the server.
 */
export async function markConsultationDone({ consultationId, outcome }) {
  const { data } = await callMarkDone({ consultationId, outcome });
  return data;
}

/**
 * The doctor can't make this appointment. The patient is emailed and the
 * hospital gives it a new time (or refunds it). `reason` is for the admin
 * team only.
 */
export async function reportDoctorUnavailable({ consultationId, reason }) {
  const { data } = await callReportUnavailable({ consultationId, ...(reason ? { reason } : {}) });
  return data;
}

// ---------------------------------------------------------------------------
// Doctor public profile (powers "Meet your doctors" on the landing page).
// ---------------------------------------------------------------------------

export async function fetchDoctorProfile(doctorUid) {
  const snap = await getDoc(doc(db, "doctorProfiles", doctorUid));
  return snap.exists() ? snap.data() : null;
}

// Only these fields may be written by a doctor (enforced by firestore.rules).
const EDITABLE_FIELDS = [
  "title",
  "yearsExperience",
  "specialties",
  "languages",
  "focus",
  "bio",
  "photoURL",
  "isAvailable",
  "availabilityNote",
];

export async function updateDoctorProfile(doctorUid, updates) {
  const allowed = Object.fromEntries(
    Object.entries(updates).filter(([key]) => EDITABLE_FIELDS.includes(key)),
  );
  const profileRef = doc(db, "doctorProfiles", doctorUid);
  await updateDoc(profileRef, { ...allowed, updatedAt: serverTimestamp() });
  const snap = await getDoc(profileRef);
  return snap.data();
}

// Uploads to doctorProfilePictures/{doctorUid}/profile.jpg. `imageBlob` must
// already be resized (resizeProfilePhoto in docUtils.js); Storage rules cap
// the size at 1 MB and require image/jpeg.
export async function uploadDoctorProfilePicture(doctorUid, imageBlob) {
  const fileRef = storageRef(storage, `doctorProfilePictures/${doctorUid}/profile.jpg`);
  await uploadBytes(fileRef, imageBlob, { contentType: "image/jpeg" });
  const photoURL = await getDownloadURL(fileRef);
  return { photoURL };
}
