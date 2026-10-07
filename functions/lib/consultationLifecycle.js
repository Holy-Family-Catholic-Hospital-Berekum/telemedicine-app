// functions/lib/consultationLifecycle.js
//
// How a consultation ends. Shared by markConsultationDone (doctor/admin),
// the automatic no-show job (noShow.js) and refunds (refunds.js).
//
//   markNoShow        the patient didn't come. The booking and consultation
//                     are KEPT (status "no_show"), so the patient can pay
//                     the no-show fee and reschedule, or ask for a refund
//                     (minus the kept share). If they do neither within
//                     NO_SHOW_HOLD_DAYS, closeConsultation runs (noShow.js).
//   closeConsultation writes the short history record and permanently
//                     deletes the booking, the consultation and the patient
//                     details they held (hospital retention decision).
//
// No-show timing (noShowDeadline): the patient has the policy's
// waitMinutes to join, counted from the start time or, for an online call,
// from when the doctor joined if that was later. Online, it only applies
// once the doctor has joined (if the doctor never came, it isn't the
// patient's no-show). Nobody can mark a no-show before the deadline.
//
// Late reschedules (rescheduleCountsAsNoShow): from the start time on, a
// patient who hasn't joined and asks for a new time is treated as a no-show
// straight away (markNoShow byPatient), so the no-show fee applies. Not if
// the doctor is to blame: an online call whose doctor hasn't joined, or
// joined, only after the waiting time. A reschedule asked for BEFORE the
// start protects the consultation from being marked a no-show.

const logger = require("firebase-functions/logger");
const {
  db,
  FieldValue,
  Timestamp,
  serverTime,
  HttpsError,
  toDate,
  audit,
  deleteTree,
} = require("./core");
const { queueEmail } = require("./mailQueue");
const { loadNoShowPolicy } = require("../siteSettings");

const NO_SHOW_HOLD_DAYS = 14;

/** When the patient counts as a no-show (ms), or null if it can't apply yet. */
function noShowDeadline(c, waitMinutes) {
  const start = toDate(c.scheduledTime)?.getTime();
  if (!start) return null;
  let base = start;
  if (c.mode === "online") {
    const doctorIn = toDate(c.doctorFirstJoinedAt)?.getTime();
    if (!doctorIn) return null;
    base = Math.max(start, doctorIn);
  }
  return base + waitMinutes * 60 * 1000;
}

/** True if a reschedule asked for now counts as a no-show (fee applies). */
function rescheduleCountsAsNoShow(c, waitMinutes, now = Date.now()) {
  const start = toDate(c.scheduledTime)?.getTime();
  if (!start || now < start || c.patientFirstJoinedAt) return false;
  if (c.mode === "online") {
    const graceEnd = start + waitMinutes * 60 * 1000;
    const doctorIn = toDate(c.doctorFirstJoinedAt)?.getTime();
    if (doctorIn ? doctorIn > graceEnd : now >= graceEnd) return false; // doctor late
  }
  return true;
}

/**
 * actor: { uid, role } ("system" for the automatic job)
 * byPatient: the patient asked for a new time after the start
 * (rescheduleCountsAsNoShow); no waiting-time deadline applies.
 * expectDoctorUid: when a doctor acts, the consultation must be theirs.
 * Throws HttpsError if it can't be marked yet. Resolves true if marked,
 * false if it already was.
 */
async function markNoShow({ consultationId, actor, meta = null, expectDoctorUid = null, byPatient = false }) {
  const policy = await loadNoShowPolicy();
  const consultationRef = db.collection("consultations").doc(consultationId);

  const marked = await db.runTransaction(async (tx) => {
    const snap = await tx.get(consultationRef);
    if (!snap.exists) throw new HttpsError("not-found", "Consultation not found.");
    const c = snap.data();
    if (expectDoctorUid && c.doctorUid !== expectDoctorUid) {
      throw new HttpsError("not-found", "Consultation not found.");
    }
    if (c.status === "no_show") return null; // idempotent
    if (!["scheduled", "in_progress"].includes(c.status)) {
      throw new HttpsError("failed-precondition", "This consultation is closed.");
    }
    if (c.patientFirstJoinedAt) {
      throw new HttpsError("failed-precondition", "The patient joined this consultation, so it isn't a no-show.");
    }
    const bookingRef = db.collection("bookings").doc(c.bookingId);
    const bookingSnap = await tx.get(bookingRef);
    const booking = bookingSnap.exists ? bookingSnap.data() : null;

    if (byPatient) {
      if (!rescheduleCountsAsNoShow(c, policy.waitMinutes)) {
        throw new HttpsError("failed-precondition", "This consultation can be rescheduled without a fee.");
      }
    } else {
      // The patient asked for a new time before the start: not a no-show.
      if (booking?.rescheduleRequest?.status === "requested") {
        if (actor.role === "system") return null;
        throw new HttpsError(
          "failed-precondition",
          "The patient asked to reschedule this consultation before it started, so it isn't a no-show.",
        );
      }
      const deadline = noShowDeadline(c, policy.waitMinutes);
      if (deadline === null) {
        throw new HttpsError(
          "failed-precondition",
          "A no-show can only be marked after the doctor has joined the call and waited for the patient.",
        );
      }
      if (Date.now() < deadline) {
        const mins = Math.ceil((deadline - Date.now()) / 60000);
        throw new HttpsError(
          "failed-precondition",
          `The patient still has ${mins} minute${mins === 1 ? "" : "s"} to join. A no-show can be marked after that.`,
        );
      }
    }
    // A free hospital visit (pay at the hospital) has no fee or refund to
    // hold for: it closes at the next hourly run and the patient can book
    // again.
    const free = booking?.payAtHospital === true;
    const holdUntil = Timestamp.fromMillis(Date.now() + (free ? 0 : NO_SHOW_HOLD_DAYS * 86400 * 1000));
    // The policy the patient is held to, fixed at this moment.
    const noShowTerms = {
      forfeitPercent: policy.forfeitPercent,
      rescheduleFee: policy.rescheduleFee,
      waitMinutes: policy.waitMinutes,
    };

    tx.update(consultationRef, {
      status: "no_show",
      noShowAt: serverTime(),
      noShowBy: actor.uid,
      noShowExpiresAt: holdUntil,
      updatedAt: serverTime(),
    });
    if (booking && free) {
      tx.update(bookingRef, {
        status: "no_show",
        noShowAt: serverTime(),
        noShowExpiresAt: holdUntil,
        rescheduleRequest: FieldValue.delete(),
        updatedAt: serverTime(),
      });
    } else if (booking) {
      tx.update(bookingRef, {
        status: "no_show",
        noShowAt: serverTime(),
        noShowExpiresAt: holdUntil,
        noShowTerms,
        rescheduleRequest: FieldValue.delete(),
        updatedAt: serverTime(),
      });
      queueEmail(tx, {
        bookingId: c.bookingId,
        to: booking.email,
        kind: "patient_no_show",
        data: {
          patientName: booking.guardianName || booking.patientName || "",
          doctorName: c.doctorName || "",
          type: c.type,
          mode: c.mode,
          scheduledAt: toDate(c.scheduledTime).getTime(),
          consultationId,
          noShow: noShowTerms,
          amountPaid: Number(booking.amountPaid || 0),
          holdUntil: holdUntil.toMillis(),
          byPatient,
        },
        sendBefore: holdUntil.toMillis(),
      });
    }
    audit(tx, {
      actorId: actor.uid,
      actorRole: actor.role,
      action: byPatient
        ? "Asked to reschedule after the start time (counts as a no-show)"
        : actor.role === "system"
          ? "Marked a consultation as a no-show automatically (patient didn't join in time)"
          : "Marked a consultation as a no-show",
      code: "consultation.no_show",
      category: "consultation",
      targetType: "consultation",
      targetId: consultationId,
      patientUid: c.patientUid,
      details: { waitMinutes: policy.waitMinutes, byPatient },
      meta,
    });
    return true;
  });

  if (marked) {
    await deleteTree(db.collection("calls").doc(consultationId)).catch((err) =>
      logger.warn("call cleanup after no-show failed", err),
    );
  }
  return Boolean(marked);
}

/**
 * Closes a consultation: history record, then the booking, consultation
 * and their patient details are deleted. Idempotent.
 * outcome: "completed" | "no_show"
 * Resolves { forfeitAmount, refundOwed, patientUid } or null if already closed.
 */
async function closeConsultation({ consultationId, outcome, actor, meta = null, expectDoctorUid = null }) {
  const consultationRef = db.collection("consultations").doc(consultationId);
  const historyRef = db.collection("consultationHistory").doc(consultationId);
  const callRef = db.collection("calls").doc(consultationId);

  // Was recording expected for this call? Read before the shell goes.
  const callSnap = await callRef.get();
  const recordingExpected = callSnap.exists && callSnap.data().recordingEnabled === true;
  const policy = outcome === "no_show" ? await loadNoShowPolicy() : null;

  const closed = await db.runTransaction(async (tx) => {
    const [consultationSnap, historySnap] = await Promise.all([
      tx.get(consultationRef),
      tx.get(historyRef),
    ]);
    if (!consultationSnap.exists) {
      if (historySnap.exists) return null; // already closed: idempotent
      throw new HttpsError("not-found", "Consultation not found.");
    }
    const c = consultationSnap.data();
    if (expectDoctorUid && c.doctorUid !== expectDoctorUid) {
      throw new HttpsError("not-found", "Consultation not found.");
    }
    // A held no-show is closed only as a no-show, and never by its doctor
    // (the patient may still pay to reschedule or ask for a refund).
    if (c.status === "no_show" && (outcome !== "no_show" || expectDoctorUid)) {
      throw new HttpsError("failed-precondition", "This consultation was marked as a no-show.");
    }

    const bookingRef = db.collection("bookings").doc(c.bookingId);
    const bookingSnap = await tx.get(bookingRef);
    const booking = bookingSnap.exists ? bookingSnap.data() : {};
    const amountPaid = Number(booking.amountPaid ?? 0);

    let forfeitAmount = 0;
    let refundOwed = 0;
    if (outcome === "no_show") {
      const percent = booking.noShowTerms?.forfeitPercent ?? policy.forfeitPercent;
      forfeitAmount = Math.round(amountPaid * (percent / 100) * 100) / 100;
      refundOwed = Math.round((amountPaid - forfeitAmount) * 100) / 100;
    }

    // What survives: no date of birth, sex, location or phone.
    tx.set(historyRef, {
      consultationId,
      patientUid: c.patientUid,
      doctorUid: c.doctorUid,
      doctorName: c.doctorName || null,
      type: c.type,
      mode: c.mode,
      outcome,
      scheduledTime: c.scheduledTime,
      // Online: when the call actually began. In person: the booked time.
      startedAt: c.callStartedAt || c.scheduledTime,
      // Whether each side joined the video call (online only). A patient
      // who joined can't ask for a refund (refunds.js).
      patientJoined: Boolean(c.patientFirstJoinedAt),
      doctorJoined: Boolean(c.doctorFirstJoinedAt),
      endedAt: serverTime(),
      amountPaid,
      noShowFeePaid: Number(booking.noShowFee?.amount || 0),
      currency: booking.currency || "GHS",
      forfeitAmount,
      refundOwed,
      // A held no-show that closed (hold over, or closed by an admin): the
      // patient's chance to reschedule or ask for a refund has ended.
      refundClosed: c.status === "no_show",
      paystackReference: booking.paystackReference || null,
      // Lets refundSync.js trace a refund of this payment on Paystack.
      paystackTransactionId: booking.paystackTransactionId || null,
      closedByUid: actor.uid,
      closedByRole: actor.role,
      createdAt: serverTime(),
    });

    tx.delete(consultationRef);
    if (bookingSnap.exists) tx.delete(bookingRef);

    audit(tx, {
      actorId: actor.uid,
      actorRole: actor.role,
      action: outcome === "no_show" ? "Closed a no-show consultation" : "Closed a consultation as completed",
      code: outcome === "no_show" ? "consultation.closed_no_show" : "consultation.closed",
      category: "consultation",
      targetType: "consultation",
      targetId: consultationId,
      patientUid: c.patientUid,
      details: refundOwed > 0 ? { refundOwed } : null,
      meta,
    });

    return {
      txRefs: [...(booking.txRefs || []), ...(booking.feeTxRefs || [])],
      patientUid: c.patientUid,
      forfeitAmount,
      refundOwed,
    };
  });

  if (closed) {
    // Tidy-up after commit; failures here don't undo the close.
    await Promise.all([
      deleteTree(callRef).catch((err) => logger.warn("call cleanup failed", err)),
      ...closed.txRefs.map((ref) =>
        db.collection("paymentRefs").doc(ref).delete().catch(() => {}),
      ),
    ]);

    if (recordingExpected) {
      const recs = await db
        .collection("recordings")
        .where("consultationId", "==", consultationId)
        .limit(1)
        .get();
      if (recs.empty) {
        await audit(null, {
          action: "Recording was switched on but this call has no recording",
          code: "recording.missing",
          category: "recording",
          result: "failed",
          targetType: "consultation",
          targetId: consultationId,
          patientUid: closed.patientUid,
        });
      }
    }
  }
  return closed;
}

module.exports = { noShowDeadline, rescheduleCountsAsNoShow, markNoShow, closeConsultation, NO_SHOW_HOLD_DAYS };
