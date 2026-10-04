// functions/refunds.js
//
//   requestRefund        patient asks for a refund of a consultation they
//                        did not attend (only after the scheduled day has
//                        passed; one request per consultation)
//   resolveRefundRequest admin records the outcome after refunding manually
//
// Refunds are made by hand (Paystack dashboard, or mobile money), so each
// request carries what the admin needs: who, how to reach and pay them,
// how much was paid, the Paystack reference, and what happened. The phone
// number on the request is one the patient gives for the refund (the
// booking's phone is deleted when the consultation closes). Requests are
// kept as financial records and every step is audited.
//
// Who can ask (terms of service, "Cancellations and refunds"): a patient
// whose consultation was scheduled but who did not attend it. A patient
// who joined the video call, or whose in-person visit was closed as
// completed, can't ask for a refund. Rescheduling is the first option the
// dashboard offers; a refund and a reschedule of the same consultation
// exclude each other.

const {
  onCall,
  db,
  serverTime,
  HttpsError,
  requireRole,
  requireVerifiedEmail,
  requestMeta,
  str,
  docId,
  phoneE164,
  toDate,
  audit,
  rateLimit,
} = require("./lib/core");

/** YYYY-MM-DD in hospital time. Ghana is UTC+0 all year. */
const hospitalDay = (date) => date.toISOString().slice(0, 10);

const NOT_ELIGIBLE =
  "You attended this consultation, so it can't be refunded. If something " +
  "went wrong, please call the hospital.";

/**
 * data: { source: "history" | "booking", id, reason, refundPhone }
 *   history: id = consultationId of a consultation closed as a no-show
 *   booking: id = bookingId of a scheduled consultation that never closed
 */
exports.requestRefund = onCall(async (request) => {
  const caller = await requireRole(request, ["patient"]);
  requireVerifiedEmail(caller);
  const d = request.data || {};
  const source = d.source === "booking" ? "booking" : "history";
  const id = docId(d.id, "Consultation");
  const reason = str(d.reason, { field: "Reason", max: 500, min: 5 });
  const refundPhone = phoneE164(d.refundPhone);

  await rateLimit(caller.uid, "requestRefund", { max: 5, windowSeconds: 86400 });

  const sourceRef = db.collection(source === "history" ? "consultationHistory" : "bookings").doc(id);
  const snap = await sourceRef.get();
  const rec = snap.exists ? snap.data() : null;
  if (!rec || rec.patientUid !== caller.uid) {
    throw new HttpsError("not-found", "Consultation not found.");
  }
  if (source === "booking") {
    if (rec.status !== "scheduled" || !rec.consultationId) {
      throw new HttpsError("failed-precondition", "Only scheduled consultations can be refunded.");
    }
    if (rec.rescheduleRequest?.status === "requested") {
      throw new HttpsError(
        "failed-precondition",
        "You've asked to reschedule this consultation. Wait for the new time, or call the hospital.",
      );
    }
    const consultation = await db.collection("consultations").doc(rec.consultationId).get();
    if (rec.patientJoinedAt || consultation.data()?.patientFirstJoinedAt) {
      throw new HttpsError("failed-precondition", NOT_ELIGIBLE);
    }
  } else if (rec.outcome !== "no_show" || rec.patientJoined === true) {
    throw new HttpsError("failed-precondition", NOT_ELIGIBLE);
  }

  const scheduled = toDate(rec.scheduledTime);
  if (!scheduled || hospitalDay(scheduled) >= hospitalDay(new Date())) {
    throw new HttpsError(
      "failed-precondition",
      "You can request a refund once the day of your appointment has passed.",
    );
  }
  const amountPaid = Number(rec.amountPaid || 0);
  if (!(amountPaid > 0)) {
    throw new HttpsError("failed-precondition", "There is no payment to refund for this consultation.");
  }

  const consultationId = source === "history" ? id : rec.consultationId;
  const requestRef = db.collection("refundRequests").doc(consultationId);
  const meta = requestMeta(request);

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(requestRef);
    if (existing.exists) {
      throw new HttpsError("already-exists", "You've already requested a refund for this consultation.");
    }
    tx.set(requestRef, {
      consultationId,
      bookingId: source === "booking" ? id : null,
      patientUid: caller.uid,
      patientName: caller.profile.name || null,
      email: caller.token.email || null,
      accountPhone: caller.profile.phone || null,
      refundPhone,
      doctorName: rec.doctorName || null,
      type: rec.type,
      mode: rec.mode,
      scheduledTime: rec.scheduledTime,
      outcome: source === "history" ? rec.outcome : "not_closed",
      amountPaid,
      currency: rec.currency || "GHS",
      // For a patient no-show the hospital keeps a share (see
      // markConsultationDone); this is the amount it worked out as owed.
      suggestedRefund: source === "history" && rec.outcome === "no_show"
        ? Number(rec.refundOwed || 0)
        : amountPaid,
      paystackReference: rec.paystackReference || null,
      reason,
      status: "requested",
      createdAt: serverTime(),
    });
    audit(tx, {
      actorId: caller.uid,
      actorRole: "patient",
      action: "Requested a refund",
      code: "payment.refund_requested",
      category: "payment",
      targetType: "consultation",
      targetId: consultationId,
      patientUid: caller.uid,
      meta,
    });
  });

  return { requested: true, consultationId };
});

/** data: { consultationId, decision: "refunded" | "declined", note, amountRefunded? } */
exports.resolveRefundRequest = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const d = request.data || {};
  const consultationId = docId(d.consultationId, "Consultation");
  const decision = d.decision === "declined" ? "declined" : "refunded";
  const note = str(d.note, { field: "Note", max: 500, min: 3 });
  const amountRefunded =
    decision === "refunded" && Number.isFinite(Number(d.amountRefunded))
      ? Math.round(Number(d.amountRefunded) * 100) / 100
      : null;

  const ref = db.collection("refundRequests").doc(consultationId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Refund request not found.");
    const r = snap.data();
    if (r.status !== "requested") {
      throw new HttpsError("failed-precondition", "This request has already been handled.");
    }
    if (amountRefunded !== null && (amountRefunded <= 0 || amountRefunded > r.amountPaid)) {
      throw new HttpsError("invalid-argument", "The refunded amount must be between 0 and the amount paid.");
    }
    tx.update(ref, {
      status: decision,
      amountRefunded,
      note,
      resolvedByUid: caller.uid,
      resolvedAt: serverTime(),
    });
    audit(tx, {
      actorId: caller.uid,
      actorRole: "admin",
      action: decision === "refunded" ? "Refunded a consultation" : "Declined a refund request",
      code: decision === "refunded" ? "payment.refunded" : "payment.refund_declined",
      category: "payment",
      targetType: "consultation",
      targetId: consultationId,
      patientUid: r.patientUid,
      reason: note,
      details: amountRefunded !== null ? { amountRefunded } : null,
      meta: requestMeta(request),
    });
  });
  return { ok: true };
});
