// functions/noShow.js
//
//   autoMarkNoShows       every minute: enforces the video-call waiting rule
//                         (lib/consultationLifecycle.js waitDeadline). When
//                         a side's countdown runs out and they aren't in the
//                         room: the patient is marked a no-show, or the
//                         doctor counts as not making it
//                         (markDoctorUnavailable: patient and admins told,
//                         free new time or full refund, doctor emailed).
//   closeExpiredNoShows   hourly: no-shows the patient left alone for
//                         NO_SHOW_HOLD_DAYS are closed (history kept, booking
//                         details deleted)
//   startNoShowReschedule patient wants a new time after a no-show: pays the
//                         no-show fee (Paystack, same popup as booking), or
//                         goes straight to a reschedule request if the fee
//                         is 0
//   getNoShowFeeStatus    the page asks whether the fee payment went through
//
// A reschedule asked for after the start time goes the same way
// (scheduling.js requestReschedule -> markNoShow byPatient ->
// beginNoShowReschedule).
//
// Fee payments reuse the booking payment safeguards: a fresh reference per
// attempt (HFH-xxxxxx-<bookingId>, recorded in paymentRefs with purpose
// "noshow_fee"), confirmed only by Paystack's verify endpoint (pull here,
// or the signed webhook in payments.js), idempotently. A fee paid after the
// booking was closed or already reopened is flagged and refunded
// automatically, like any other payment we can't use.

const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const {
  onCall,
  db,
  FieldValue,
  Timestamp,
  serverTime,
  HttpsError,
  requireRole,
  requireVerifiedEmail,
  requestMeta,
  str,
  docId,
  randomCode,
  toDate,
  audit,
  rateLimit,
} = require("./lib/core");
const { PAYSTACK_SECRET_KEY, secretKey } = require("./lib/paystack");
const { queueEmail } = require("./lib/mailQueue");
const {
  markNoShow,
  markDoctorUnavailable,
  closeConsultation,
  waitDeadline,
  isPresent,
} = require("./lib/consultationLifecycle");
const { loadNoShowPolicy } = require("./siteSettings");

const CURRENCY = "GHS";

/* ------------------------------------------------------------------ */
/* automatic no-show and expiry                                        */
/* ------------------------------------------------------------------ */

exports.autoMarkNoShows = onSchedule({ schedule: "every 1 minutes", timeoutSeconds: 120 }, async () => {
  const policy = await loadNoShowPolicy();
  const now = Date.now();
  // Single-field range on scheduledTime: no composite index needed. A
  // deadline is never before the start, and the room closes 4 h after it.
  const snap = await db
    .collection("consultations")
    .where("scheduledTime", ">=", Timestamp.fromMillis(now - LOOKBACK_MS))
    .where("scheduledTime", "<=", Timestamp.fromMillis(now))
    .limit(500)
    .get();
  const system = { uid: "system", role: "system" };
  for (const doc of snap.docs) {
    const c = doc.data();
    if (
      c.mode !== "online" ||
      !["scheduled", "in_progress"].includes(c.status) ||
      c.doctorUnavailable ||
      c.metAt
    ) {
      continue;
    }
    const dl = waitDeadline(c, policy.waitMinutes);
    if (!dl || now < dl.at || isPresent(c, dl.for, now)) continue;
    try {
      if (dl.for === "doctor") {
        const marked = await markDoctorUnavailable({ consultationId: doc.id, actor: system });
        if (marked) await emailDoctorMissed(marked, policy.waitMinutes);
      } else {
        await markNoShow({ consultationId: doc.id, actor: system });
      }
    } catch (err) {
      logger.warn("Automatic no-show skipped", { consultationId: doc.id, for: dl.for, err: err.message });
    }
  }
});

// How far back the job looks (the video room closes 4 h after the start).
const LOOKBACK_MS = 6 * 3600 * 1000;

/** Tells the doctor their call was passed to the hospital to reschedule. */
async function emailDoctorMissed(c, waitMinutes) {
  // deepcode ignore Sqli: Firestore document ID, not SQL; doctorUid read from a server-written consultation.
  const doctorSnap = await db.collection("adminUsers").doc(c.doctorUid).get();
  const doctor = doctorSnap.exists ? doctorSnap.data() : null;
  if (!doctor?.email || doctor.status !== "active") return;
  const batch = db.batch();
  queueEmail(batch, {
    to: doctor.email,
    kind: "doctor_missed",
    data: {
      doctorName: doctor.name || "",
      type: c.type,
      mode: c.mode,
      scheduledAt: toDate(c.scheduledTime).getTime(),
      waitMinutes,
    },
    // Sent after the start time, so not the default send-by.
    sendBefore: Date.now() + 24 * 3600 * 1000,
  });
  await batch.commit().catch((err) => logger.warn("doctor-missed email not queued", err));
}

exports.closeExpiredNoShows = onSchedule({ schedule: "every 60 minutes", timeoutSeconds: 300 }, async () => {
  const snap = await db
    .collection("consultations")
    .where("status", "==", "no_show")
    .where("noShowExpiresAt", "<", Timestamp.now())
    .limit(200)
    .get();
  for (const doc of snap.docs) {
    try {
      await closeConsultation({
        consultationId: doc.id,
        outcome: "no_show",
        actor: { uid: "system", role: "system" },
      });
    } catch (err) {
      logger.error("Closing an expired no-show failed", { consultationId: doc.id, err: err.message });
    }
  }
});

/* ------------------------------------------------------------------ */
/* the fee payment                                                     */
/* ------------------------------------------------------------------ */

async function verifyTransaction(reference) {
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretKey()}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(`Paystack verify ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body?.data || null;
}

/** Reopens a no-show as a reschedule request (inside `tx`, after reads). */
function reopenForReschedule(tx, { bookingRef, booking, consultationRef, fee }) {
  const pending = booking.pendingNoShowRequest || {};
  tx.update(bookingRef, {
    status: "scheduled",
    ...(fee ? { noShowFee: fee } : {}),
    rescheduleRequest: {
      status: "requested",
      preferredTime: pending.preferredTime || null,
      reason: pending.reason || null,
      afterNoShow: true,
      requestedAt: Timestamp.now(),
    },
    pendingNoShowRequest: FieldValue.delete(),
    noShowAt: FieldValue.delete(),
    noShowExpiresAt: FieldValue.delete(),
    callStartedAt: null,
    patientJoinedAt: FieldValue.delete(),
    doctorJoinedAt: FieldValue.delete(),
    waitDeadline: FieldValue.delete(),
    metAt: FieldValue.delete(),
    updatedAt: serverTime(),
  });
  tx.update(consultationRef, {
    status: "scheduled",
    noShowAt: FieldValue.delete(),
    noShowBy: FieldValue.delete(),
    noShowExpiresAt: FieldValue.delete(),
    callStartedAt: null,
    patientFirstJoinedAt: FieldValue.delete(),
    doctorFirstJoinedAt: FieldValue.delete(),
    presence: FieldValue.delete(),
    waitDeadline: FieldValue.delete(),
    metAt: FieldValue.delete(),
    reminders: FieldValue.delete(),
    updatedAt: serverTime(),
  });
}

/**
 * Applies a successful no-show fee payment, exactly once.
 * Resolves { status: "reopened" | "already" | "rejected" | "missing", duplicate? }.
 */
async function markNoShowFeePaid(bookingRef, paystackData, via) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists) return { status: "missing" };
    const booking = snap.data();
    const refs = Array.isArray(booking.feeTxRefs) ? booking.feeTxRefs : [];
    const ours = paystackData?.status === "success" && refs.includes(paystackData.reference);
    if (booking.status !== "no_show") {
      // Paid twice, or after the booking moved on: refund it.
      const already = booking.noShowFee?.reference === paystackData?.reference;
      return { status: "already", duplicate: ours && !already };
    }
    const fee = Number(booking.noShowTerms?.rescheduleFee || 0);
    if (
      !ours ||
      paystackData.currency !== CURRENCY ||
      !(Number(paystackData.amount) >= Math.round(fee * 100))
    ) {
      return { status: "rejected" };
    }
    const consultationRef = db.collection("consultations").doc(booking.consultationId);
    const consultationSnap = await tx.get(consultationRef);
    if (!consultationSnap.exists) return { status: "missing" };

    const amount = Number(paystackData.amount) / 100;
    reopenForReschedule(tx, {
      bookingRef,
      booking,
      consultationRef,
      fee: { amount, reference: paystackData.reference, paidAt: Timestamp.now(), via },
    });
    // Revenue record, like the consultation fee (no personal details).
    tx.set(db.collection("confirmedPayments").doc(paystackData.reference), {
      amount,
      fees: Number(paystackData.fees || 0) / 100, // kept by Paystack
      type: "NO_SHOW_FEE",
      mode: booking.mode,
      channel: paystackData.channel || null,
      reference: paystackData.reference,
      paidAt: serverTime(),
    });
    audit(tx, {
      actorId: "system",
      action: "No-show fee paid; reschedule requested",
      code: "payment.no_show_fee_paid",
      category: "payment",
      targetType: "booking",
      targetId: bookingRef.id,
      patientUid: booking.patientUid,
      details: { via, reference: paystackData.reference, amount },
    });
    return { status: "reopened" };
  });
}

/** Newest fee attempt first; applies a success. "paid" | "in_flight" | "failed" | "none". */
async function checkFeeAttempts(bookingRef, booking) {
  const refs = Array.isArray(booking.feeTxRefs) ? [...booking.feeTxRefs].reverse() : [];
  for (const reference of refs) {
    let tx;
    try {
      tx = await verifyTransaction(reference);
    } catch (err) {
      if (err.status === 404 || err.status === 400) continue;
      return "in_flight"; // couldn't ask: be safe
    }
    if (tx?.status === "success") {
      const result = await markNoShowFeePaid(bookingRef, tx, "verify_api");
      if (result.duplicate) {
        const { recordPaymentIssue } = require("./payments");
        await recordPaymentIssue(tx, { reason: "duplicate_payment", bookingId: bookingRef.id, patientUid: booking.patientUid });
      }
      return "paid";
    }
    const created = Date.parse(tx?.created_at || "");
    const recent = Number.isFinite(created) && Date.now() - created < 30 * 60 * 1000;
    if (recent && !["failed", "abandoned", "reversed"].includes(tx?.status)) return "in_flight";
  }
  return refs.length ? "failed" : "none";
}

/**
 * data: { bookingId, preferredTime?, reason? }
 * Resolves { status: "requested" } (fee 0, or already paid) or the popup
 * details { status: "pay", reference, amount, currency, customer }.
 */
exports.startNoShowReschedule = onCall({ secrets: [PAYSTACK_SECRET_KEY] }, async (request) => {
  const caller = await requireRole(request, ["patient"]);
  requireVerifiedEmail(caller);
  const d = request.data || {};
  const bookingId = docId(d.bookingId, "Booking");
  const preferredTime = str(d.preferredTime, { field: "Preferred time", max: 80, optional: true });
  const reason = str(d.reason, { field: "Reason", max: 300, optional: true });
  await rateLimit(caller.uid, "startNoShowReschedule", { max: 20, windowSeconds: 3600 });
  return beginNoShowReschedule({ caller, bookingId, preferredTime, reason, meta: requestMeta(request) });
});

/**
 * Shared by startNoShowReschedule and a late requestReschedule
 * (scheduling.js). The caller is the booking's verified patient.
 */
async function beginNoShowReschedule({ caller, bookingId, preferredTime = null, reason = null, meta = null }) {
  const bookingRef = db.collection("bookings").doc(bookingId);
  const snap = await bookingRef.get();
  const booking = snap.exists ? snap.data() : null;
  if (!booking || booking.patientUid !== caller.uid) throw new HttpsError("not-found", "Booking not found.");
  if (booking.status !== "no_show") {
    throw new HttpsError("failed-precondition", "This booking isn't waiting for a no-show reschedule.");
  }
  if ((booking.noShowExpiresAt?.toMillis?.() ?? 0) < Date.now()) {
    throw new HttpsError("failed-precondition", "The time to reschedule this missed consultation has passed.");
  }
  const refund = await db.collection("refundRequests").doc(booking.consultationId).get();
  if (refund.exists) {
    throw new HttpsError("failed-precondition", "You've asked for a refund for this consultation, so it can't be rescheduled.");
  }

  // Remember what the patient asked for; applied when the fee is confirmed.
  await bookingRef.update({ pendingNoShowRequest: { preferredTime, reason } });
  const fee = Number(booking.noShowTerms?.rescheduleFee || 0);

  if (fee <= 0) {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(bookingRef);
      if (fresh.data()?.status !== "no_show") return;
      const consultationRef = db.collection("consultations").doc(booking.consultationId);
      await tx.get(consultationRef);
      reopenForReschedule(tx, { bookingRef, booking: fresh.data(), consultationRef, fee: null });
      audit(tx, {
        actorId: caller.uid,
        actorRole: "patient",
        action: "Asked to reschedule a missed consultation (no fee)",
        code: "booking.reschedule_requested",
        category: "booking",
        targetType: "consultation",
        targetId: booking.consultationId,
        patientUid: caller.uid,
        meta: meta,
      });
    });
    return { status: "requested" };
  }

  const state = await checkFeeAttempts(bookingRef, booking);
  if (state === "paid") return { status: "requested" };
  if (state === "in_flight") {
    throw new HttpsError(
      "failed-precondition",
      "Your last payment attempt is still being processed. Approve or decline the prompt on your phone, then wait a minute before trying again.",
    );
  }
  if ((booking.feeTxRefs || []).length >= 10) {
    throw new HttpsError("resource-exhausted", "Too many payment attempts. Please contact the hospital.");
  }

  const reference = `HFH-${randomCode(6)}-${bookingId}`;
  const batch = db.batch();
  batch.update(bookingRef, { feeTxRefs: FieldValue.arrayUnion(reference) });
  batch.set(db.collection("paymentRefs").doc(reference), {
    bookingId,
    patientUid: caller.uid,
    purpose: "noshow_fee",
    createdAt: serverTime(),
  });
  await batch.commit();
  return {
    status: "pay",
    reference,
    amount: fee,
    currency: CURRENCY,
    customer: {
      name: booking.guardianName || booking.patientName || "",
      email: booking.email || "",
      phone: booking.phone || "",
    },
  };
}

/** data: { bookingId } -> { status: "confirmed" | "pending" | "failed" } */
exports.getNoShowFeeStatus = onCall({ secrets: [PAYSTACK_SECRET_KEY] }, async (request) => {
  const caller = await requireRole(request, ["patient"]);
  const bookingId = docId(request.data?.bookingId, "Booking");
  await rateLimit(caller.uid, "getNoShowFeeStatus", { max: 120, windowSeconds: 3600 });
  const bookingRef = db.collection("bookings").doc(bookingId);
  const snap = await bookingRef.get();
  const booking = snap.exists ? snap.data() : null;
  if (!booking || booking.patientUid !== caller.uid) throw new HttpsError("not-found", "Booking not found.");
  if (booking.status !== "no_show") return { status: "confirmed" };
  const state = await checkFeeAttempts(bookingRef, booking);
  if (state === "paid") return { status: "confirmed" };
  if (state === "failed") return { status: "failed" };
  return { status: "pending" };
});

exports.markNoShowFeePaid = markNoShowFeePaid;
exports.emailDoctorMissed = emailDoctorMissed;
exports.beginNoShowReschedule = beginNoShowReschedule;
