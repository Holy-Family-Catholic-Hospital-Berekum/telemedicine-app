// functions/startVideoCall.js
//
// Backs docFirestoreService.js's startVideoCall(). Register this in
// functions/index.js: exports.startVideoCall = require("./startVideoCall").startVideoCall;
// Needs the Blaze plan to deploy.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const db = getFirestore();
const CALL_UNLOCK_MINUTES_BEFORE = 5;

exports.startVideoCall = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign-in required.");
  }

  const { consultationId } = request.data ?? {};
  if (!consultationId) {
    throw new HttpsError("invalid-argument", "consultationId is required.");
  }

  const consultationRef = db.doc(`consultations/${consultationId}`);
  const consultationSnap = await consultationRef.get();
  if (!consultationSnap.exists) {
    throw new HttpsError("not-found", "Consultation not found.");
  }
  const consultation = consultationSnap.data();

  // The 5-minute lock in the UI is a convenience; this is the actual
  // enforcement point.
  if (consultation.doctorId !== uid) {
    throw new HttpsError(
      "permission-denied",
      "You are not assigned to this consultation.",
    );
  }

  const scheduledTime = consultation.scheduledTime?.toDate
    ? consultation.scheduledTime.toDate()
    : new Date(consultation.scheduledTime);
  const unlockAt = new Date(
    scheduledTime.getTime() - CALL_UNLOCK_MINUTES_BEFORE * 60 * 1000,
  );
  if (new Date() < unlockAt) {
    throw new HttpsError(
      "failed-precondition",
      `This call can't start until ${CALL_UNLOCK_MINUTES_BEFORE} minutes before the scheduled time.`,
    );
  }

  // Derived server-side — never trust a client-supplied room name.
  const roomName = `hfch-${consultationId}`;

  // Set callStartedAt the *first* time this is called; never overwrite
  // it on rejoin, so "when did this call actually start" stays accurate.
  if (!consultation.callStartedAt) {
    await consultationRef.update({
      callStartedAt: FieldValue.serverTimestamp(),
    });
  }
  const finalSnap = await consultationRef.get();
  const callStartedAt = finalSnap.data().callStartedAt;

  return {
    consultationId,
    callStartedAt: callStartedAt?.toDate
      ? callStartedAt.toDate().toISOString()
      : callStartedAt,
    roomName,
  };
});
