// functions/refunds.js
//
//   requestRefund        patient asks for a refund of a consultation they
//                        did not attend (one request per consultation)
//   resolveRefundRequest admin decides: refund through Paystack (one click,
//                        amount editable), record a manual refund, or decline
//
// Who can ask (terms of service, "Cancellations and refunds"): a patient
// whose consultation was scheduled but who did not attend it.
//   - A no-show (booking status "no_show"): straight away. The suggested
//     amount is what they paid minus the share the hospital keeps
//     (booking.noShowTerms.forfeitPercent, the no-show policy at the time).
//   - A scheduled consultation nobody closed: once its day has passed;
//     suggested in full.
//   - A no-show closed straight away (history), e.g. before no-shows were
//     held: its recorded refundOwed. Not one whose 14-day hold ran out or
//     that an admin closed (refundClosed).
// A patient who joined the video call, or whose in-person visit was closed
// as completed, can't ask. A refund and a reschedule exclude each other.
//
// A Paystack refund goes back to the ORIGINAL payment (wallet or card);
// refundSync.js follows it until Paystack reports it done or failed. When
// an admin approves a refund for a booking that's still open, the
// consultation is closed (history kept, booking details deleted).
// Requests are kept as financial records and every step is audited.

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
const { PAYSTACK_SECRET_KEY, createRefund } = require("./lib/paystack");
const { closeConsultation } = require("./lib/consultationLifecycle");

/** YYYY-MM-DD in hospital time. Ghana is UTC+0 all year. */
const hospitalDay = (date) => date.toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;

const NOT_ELIGIBLE =
  "You attended this consultation, so it can't be refunded. If something " +
  "went wrong, please call the hospital.";

/**
 * data: { source: "history" | "booking", id, reason, refundPhone? }
 *   history: id = consultationId of a consultation closed as a no-show
 *   booking: id = bookingId of a no-show, or a scheduled consultation that
 *            never closed
 * refundPhone is optional: refunds go back to the original payment; the
 * number is only for the hospital to reach the patient.
 */
exports.requestRefund = onCall(async (request) => {
  const caller = await requireRole(request, ["patient"]);
  requireVerifiedEmail(caller);
  const d = request.data || {};
  const source = d.source === "booking" ? "booking" : "history";
  const id = docId(d.id, "Consultation");
  const reason = str(d.reason, { field: "Reason", max: 500, min: 5 });
  const refundPhone = d.refundPhone ? phoneE164(d.refundPhone) : null;

  await rateLimit(caller.uid, "requestRefund", { max: 5, windowSeconds: 86400 });

  const sourceRef = db.collection(source === "history" ? "consultationHistory" : "bookings").doc(id);
  const snap = await sourceRef.get();
  const rec = snap.exists ? snap.data() : null;
  if (!rec || rec.patientUid !== caller.uid) {
    throw new HttpsError("not-found", "Consultation not found.");
  }
  const amountPaid = Number(rec.amountPaid || 0);
  if (!(amountPaid > 0)) {
    throw new HttpsError("failed-precondition", "There is no payment to refund for this consultation.");
  }

  let outcome;
  let suggestedRefund;
  if (source === "booking") {
    if (!rec.consultationId || !["scheduled", "no_show"].includes(rec.status)) {
      throw new HttpsError("failed-precondition", "Only scheduled consultations can be refunded.");
    }
    if (rec.status === "no_show") {
      const percent = Number(rec.noShowTerms?.forfeitPercent ?? 0);
      outcome = "no_show";
      suggestedRefund = round2(amountPaid * (1 - percent / 100));
    } else {
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
      const scheduled = toDate(rec.scheduledTime);
      if (!scheduled || hospitalDay(scheduled) >= hospitalDay(new Date())) {
        throw new HttpsError(
          "failed-precondition",
          "You can request a refund once the day of your appointment has passed.",
        );
      }
      outcome = "not_closed";
      suggestedRefund = amountPaid;
    }
  } else {
    if (rec.outcome !== "no_show" || rec.patientJoined === true) {
      throw new HttpsError("failed-precondition", NOT_ELIGIBLE);
    }
    if (rec.refundClosed === true) {
      throw new HttpsError(
        "failed-precondition",
        "The time to ask for a refund for this missed consultation has passed. If you think this is wrong, please call the hospital.",
      );
    }
    outcome = "no_show";
    suggestedRefund = Number(rec.refundOwed || 0);
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
      outcome,
      amountPaid,
      currency: rec.currency || "GHS",
      suggestedRefund,
      paystackReference: rec.paystackReference || null,
      transactionId: rec.paystackTransactionId || null,
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

  return { requested: true, consultationId, suggestedRefund };
});

/**
 * data: { consultationId, decision: "refund" | "manual" | "declined",
 *         amount? (GHS; refund/manual), note? (manual/declined, required) }
 *   refund   Paystack refund to the original payment (one click)
 *   manual   record a refund made outside Paystack
 *   declined say no, with a note
 * A request that Paystack refused ("failed") can be retried or settled
 * manually.
 */
exports.resolveRefundRequest = onCall({ secrets: [PAYSTACK_SECRET_KEY] }, async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const d = request.data || {};
  const consultationId = docId(d.consultationId, "Consultation");
  const decision = ["refund", "manual", "declined"].includes(d.decision) ? d.decision : null;
  if (!decision) throw new HttpsError("invalid-argument", "Choose refund, manual or decline.");
  const note = str(d.note, { field: "Note", max: 500, min: decision === "refund" ? 0 : 3, optional: decision === "refund" });
  const meta = requestMeta(request);
  const ref = db.collection("refundRequests").doc(consultationId);
  await rateLimit(caller.uid, "resolveRefundRequest", { max: 60, windowSeconds: 3600 });

  const amountOf = (r) => {
    const n = Number(d.amount);
    if (!Number.isFinite(n) || n <= 0 || n > r.amountPaid) {
      throw new HttpsError("invalid-argument", `The refund must be more than 0 and at most ${r.currency} ${r.amountPaid}.`);
    }
    return round2(n);
  };

  if (decision === "declined" || decision === "manual") {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", "Refund request not found.");
      const r = snap.data();
      if (!["requested", "failed"].includes(r.status)) {
        throw new HttpsError("failed-precondition", "This request is already being refunded or has been handled.");
      }
      const amountRefunded = decision === "manual" ? amountOf(r) : null;
      tx.update(ref, {
        status: decision === "manual" ? "refunded" : "declined",
        refundMethod: decision === "manual" ? "manual" : null,
        amountRefunded,
        note,
        resolvedByUid: caller.uid,
        resolvedAt: serverTime(),
        // What the Revenue tab totals (refundSync.js sets it for Paystack).
        ...(decision === "manual" ? { refundedAt: serverTime() } : {}),
      });
      audit(tx, {
        actorId: caller.uid,
        actorRole: "admin",
        action: decision === "manual" ? "Recorded a manual refund" : "Declined a refund request",
        code: decision === "manual" ? "payment.refunded" : "payment.refund_declined",
        category: "payment",
        targetType: "consultation",
        targetId: consultationId,
        patientUid: r.patientUid,
        reason: note,
        details: amountRefunded !== null ? { amountRefunded } : null,
        meta,
      });
    });
    return { status: decision === "manual" ? "refunded" : "declined" };
  }

  // Paystack: claim the request first so it can't be refunded twice.
  const r = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Refund request not found.");
    const req = snap.data();
    if (!["requested", "failed"].includes(req.status)) {
      throw new HttpsError("failed-precondition", "This request is already being refunded or has been handled.");
    }
    if (!req.paystackReference) {
      throw new HttpsError("failed-precondition", "There's no Paystack payment on record for this one. Record a manual refund instead.");
    }
    const amount = amountOf(req);
    tx.update(ref, { status: "refund_starting", refundStartingAt: serverTime(), amountRefunded: amount });
    return { ...req, amount };
  });

  let refund;
  try {
    refund = await createRefund({
      reference: r.paystackReference,
      amount: r.amount,
      customerNote: "Refund for your consultation with Holy Family Catholic Hospital.",
      merchantNote: `refundRequest ${consultationId}`,
    });
  } catch (err) {
    await ref.update({ status: "requested", lastRefundError: String(err.message).slice(0, 300) });
    await audit(null, {
      actorId: caller.uid,
      actorRole: "admin",
      action: "Paystack refused a refund",
      code: "payment.refund_failed",
      category: "payment",
      result: "failed",
      targetType: "consultation",
      targetId: consultationId,
      patientUid: r.patientUid,
      details: { error: String(err.message).slice(0, 200) },
      meta,
    });
    throw new HttpsError("failed-precondition", `Paystack didn't accept the refund: ${err.message}`);
  }

  await ref.update({
    status: "processing",
    refundMethod: "paystack",
    paystackRefundId: refund.id,
    paystackRefundStatus: refund.status,
    note: note || null,
    resolvedByUid: caller.uid,
    resolvedAt: serverTime(),
    lastRefundError: null,
  });
  await audit(null, {
    actorId: caller.uid,
    actorRole: "admin",
    action: "Approved a refund (sent to Paystack)",
    code: "payment.refund_started",
    category: "payment",
    targetType: "consultation",
    targetId: consultationId,
    patientUid: r.patientUid,
    details: { amount: r.amount },
    meta,
  });

  // The patient chose a refund over a new time: close the consultation
  // if it's still open (history kept, booking details deleted).
  if (r.bookingId) {
    await closeConsultation({
      consultationId,
      outcome: "no_show",
      actor: { uid: caller.uid, role: "admin" },
      meta,
    }).catch((err) => {
      if (err?.code !== "not-found") throw err;
    });
  }
  return { status: "processing" };
});
