// functions/markConsultationDone.js
//
// Backs docFirestoreService.js's markConsultationDone(). Register this in
// functions/index.js: exports.markConsultationDone = require("./markConsultationDone").markConsultationDone;
// Needs the Blaze plan to deploy.
//
// The client sends only { consultationId, outcome } — never an amount.
// amountPaid is looked up here, server-side, from the booking doc, and
// the forfeit/refund math runs here too. This is the one place that math
// should ever happen.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const db = getFirestore();
// TODO: move alongside the hospital's other Cloud Functions config
// instead of hardcoding — see the note on FORFEIT_PERCENTAGE in
// docMockData.js, which this should stay in sync with (or replace).
const FORFEIT_PERCENTAGE = 0.2;

exports.markConsultationDone = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign-in required.");
  }

  const { consultationId, outcome } = request.data ?? {};
  if (!consultationId || !["Completed", "No-show"].includes(outcome)) {
    throw new HttpsError(
      "invalid-argument",
      "consultationId and a valid outcome are required.",
    );
  }

  const consultationRef = db.doc(`consultations/${consultationId}`);

  const result = await db.runTransaction(async (tx) => {
    const consultationSnap = await tx.get(consultationRef);
    if (!consultationSnap.exists) {
      throw new HttpsError("not-found", "Consultation not found.");
    }
    const consultation = consultationSnap.data();

    // In-person consultations are also meant to allow an admin to
    // confirm (per 4.4) — that check belongs here once an adminUsers
    // lookup is wired in. For now this only allows the assigned doctor,
    // for both modes.
    if (consultation.doctorId !== uid) {
      throw new HttpsError(
        "permission-denied",
        "You are not assigned to this consultation.",
      );
    }

    const bookingRef = db.doc(`bookings/${consultation.bookingId}`);
    const bookingSnap = await tx.get(bookingRef);
    const booking = bookingSnap.exists ? bookingSnap.data() : {};
    const amountPaid = booking.amountPaid ?? 0;

    let forfeitAmount = 0;
    let refundOwed = 0;
    if (outcome === "No-show") {
      forfeitAmount = Math.round(amountPaid * FORFEIT_PERCENTAGE * 100) / 100;
      refundOwed = Math.round((amountPaid - forfeitAmount) * 100) / 100;
    }

    // 1. Permanent ledger entry — must land before the deletions below,
    // since amountPaid can't be reconstructed afterward.
    const ledgerRef = db.collection("referenceLedger").doc();
    tx.set(ledgerRef, {
      bookingId: consultation.bookingId,
      consultationType: consultation.type,
      mode: consultation.mode,
      outcome,
      amountPaid,
      forfeitAmount,
      refundOwed,
      scheduledTime: consultation.scheduledTime,
      completedAt: FieldValue.serverTimestamp(),
    });

    // 2. Anonymised metrics record — no patient identifiers.
    const metricsRef = db.collection("consultationMetrics").doc();
    tx.set(metricsRef, {
      doctorId: consultation.doctorId,
      type: consultation.type,
      mode: consultation.mode,
      outcome,
      completedAt: FieldValue.serverTimestamp(),
    });

    // 3. Erasure (4.6): permanently delete the session-specific documents.
    // There is no undo — the doctor-side confirmation UI (MarkDoneModal)
    // already makes that explicit before this function is ever called.
    tx.delete(consultationRef);
    tx.delete(bookingRef);
    tx.delete(db.doc(`sensitivePatientDetails/${consultationId}`));

    return { forfeitAmount, refundOwed };
  });

  // forfeitAmount/refundOwed travel back for the admin/revenue view —
  // doctor-facing components must not render them (see docFirestoreService.js).
  return { consultationId, outcome, ...result };
});
