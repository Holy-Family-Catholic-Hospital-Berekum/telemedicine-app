// functions/lateReschedule.js
//
// The late reschedule fee (hospital decision, 19 Oct 2026): a patient may
// move an appointment free of charge up to 24 hours before it starts
// (lib/consultationLifecycle.js FREE_RESCHEDULE_HOURS). Later than that,
// until the start, they pay the reschedule fee (the no-show policy's
// rescheduleFee). From the start on, the no-show rule applies instead
// (scheduling.js requestReschedule).
//
// The appointment stays booked until the fee is paid: requestReschedule
// keeps what the patient asked for in bookings.pendingLateReschedule and
// returns the Paystack popup details. Once Paystack confirms (webhook or
// verify, payments.js applyPaystackTransaction, purpose "reschedule_fee"),
// markLateRescheduleFeePaid turns it into a reschedule request for the
// admins and records the fee (bookings.lateRescheduleFees, confirmedPayments
// type RESCHEDULE_FEE). A fee that arrives after it can't be used (the
// appointment started, or a request was already made) is flagged and
// refunded automatically, like any other payment we can't use, and so is
// one approved only after the appointment started (too late to move it).

const {
  db,
  FieldValue,
  Timestamp,
  serverTime,
  HttpsError,
  audit,
} = require("./lib/core");
const { newReference } = require("./lib/paystack");

const CURRENCY = "GHS";

/**
 * Applies a successful late reschedule fee, exactly once.
 * Resolves { status: "requested" | "already" | "rejected" | "missing", duplicate? }.
 */
async function markLateRescheduleFeePaid(bookingRef, paystackData, via) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists) return { status: "missing" };
    const booking = snap.data();
    const reference = paystackData?.reference;
    const paid = paystackData?.status === "success";
    if ((booking.lateRescheduleFees || []).some((f) => f.reference === reference)) {
      return { status: "already" };
    }
    const pending = booking.pendingLateReschedule;
    // Only an attempt made for the request waiting now counts; any other
    // of ours (an earlier request, or one cleared when the booking moved
    // on) is refunded.
    const anyOfOurs = paid && (booking.lateFeeTxRefs || []).includes(reference);
    const ours = paid && (pending?.refs || []).includes(reference);
    if (booking.status !== "scheduled" || !ours || booking.rescheduleRequest?.status === "requested") {
      return anyOfOurs ? { status: "already", duplicate: true } : { status: "rejected" };
    }
    // Paid only after the appointment started (a slow mobile money
    // approval): too late to move it. Refunded; the no-show rule applies.
    const start = booking.scheduledTime?.toMillis?.() ?? 0;
    if (start && Date.now() >= start) {
      tx.update(bookingRef, { pendingLateReschedule: FieldValue.delete(), updatedAt: serverTime() });
      return { status: "already", duplicate: true };
    }
    const fee = Number(pending.fee || 0);
    if (paystackData.currency !== CURRENCY || !(Number(paystackData.amount) >= Math.round(fee * 100))) {
      return { status: "rejected" };
    }
    const amount = Number(paystackData.amount) / 100;
    tx.update(bookingRef, {
      rescheduleRequest: {
        status: "requested",
        preferredTime: pending.preferredTime || null,
        reason: pending.reason || null,
        requestedAt: Timestamp.now(),
        lateFee: amount,
      },
      lateRescheduleFees: FieldValue.arrayUnion({
        amount,
        reference: paystackData.reference,
        paidAt: Timestamp.now(),
        via,
      }),
      pendingLateReschedule: FieldValue.delete(),
      updatedAt: serverTime(),
    });
    // Revenue record, like the consultation fee (no personal details).
    tx.set(db.collection("confirmedPayments").doc(paystackData.reference), {
      amount,
      fees: Number(paystackData.fees || 0) / 100, // kept by Paystack
      type: "RESCHEDULE_FEE",
      mode: booking.mode,
      channel: paystackData.channel || null,
      reference: paystackData.reference,
      paidAt: serverTime(),
    });
    audit(tx, {
      actorId: "system",
      action: "Late reschedule fee paid; reschedule requested",
      code: "payment.reschedule_fee_paid",
      category: "payment",
      targetType: "booking",
      targetId: bookingRef.id,
      patientUid: booking.patientUid,
      details: { via, reference: paystackData.reference, amount },
    });
    return { status: "requested" };
  });
}

// How noShow.js checkFeeAttempts finds and applies these payments.
const LATE_FEE = { refsOf: (b) => b.pendingLateReschedule?.refs, apply: markLateRescheduleFeePaid };

/**
 * After requestReschedule saved bookings.pendingLateReschedule: the
 * Paystack popup details for the fee, { status: "pay", reference, amount,
 * currency, customer }, or { status: "requested" } if an earlier attempt
 * turns out to have been paid. The caller is the booking's verified patient.
 */
async function beginLateRescheduleFee({ caller, bookingId }) {
  const { checkFeeAttempts } = require("./noShow");
  const bookingRef = db.collection("bookings").doc(bookingId);
  const snap = await bookingRef.get();
  const booking = snap.exists ? snap.data() : null;
  if (!booking || booking.patientUid !== caller.uid) throw new HttpsError("not-found", "Booking not found.");
  if (!booking.pendingLateReschedule) {
    throw new HttpsError("failed-precondition", "This booking isn't waiting for a reschedule fee.");
  }
  const state = await checkFeeAttempts(bookingRef, booking, LATE_FEE);
  if (state === "paid") return { status: "requested" };
  if (state === "in_flight") {
    throw new HttpsError(
      "failed-precondition",
      "Your last payment attempt is still being processed. Approve or decline the prompt on your phone, then wait a minute before trying again.",
    );
  }
  if ((booking.pendingLateReschedule.refs || []).length >= 10) {
    throw new HttpsError("resource-exhausted", "Too many payment attempts. Please contact the hospital.");
  }

  const reference = newReference(bookingId);
  const batch = db.batch();
  // lateFeeTxRefs: every attempt ever (refund tracing, clean-up);
  // pendingLateReschedule.refs: this request's attempts.
  batch.update(bookingRef, {
    lateFeeTxRefs: FieldValue.arrayUnion(reference),
    "pendingLateReschedule.refs": FieldValue.arrayUnion(reference),
  });
  batch.set(db.collection("paymentRefs").doc(reference), {
    bookingId,
    patientUid: caller.uid,
    purpose: "reschedule_fee",
    createdAt: serverTime(),
  });
  await batch.commit();
  return {
    status: "pay",
    reference,
    amount: Number(booking.pendingLateReschedule.fee),
    currency: CURRENCY,
    customer: {
      name: booking.guardianName || booking.patientName || "",
      email: booking.email || "",
      phone: booking.phone || "",
    },
  };
}

module.exports = { markLateRescheduleFeePaid, beginLateRescheduleFee, LATE_FEE };
