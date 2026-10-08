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
// Waiting rule for a video call (hospital decision), with W = the
// no-show policy's waitMinutes:
//   - Nobody in the room by start + W: the doctor's no-show.
//   - When one side arrives in an empty room, the other side has until
//     max(start, arrival) + W to be in the room (consultations.waitDeadline
//     { for, at }); arriving early counts as arriving at the start.
//   - Leaving early protects nobody: if the waiting side leaves and the
//     other arrives later, the countdown starts again for the one who left.
//   - The deadline passing with that side not in the room: the patient's
//     no-show (markNoShow) or the doctor's (markDoctorUnavailable). noShow.js
//     enforces it every minute and startVideoCall refuses a late arrival.
//   - Once both are actually connected (metAt) the consultation has taken
//     place and no deadlines apply. If it can't be finished, the doctor
//     reports "call couldn't be completed" (markDoctorUnavailable kind
//     "call_incomplete"): free new time or full refund.
// Who's in the room comes from consultations.presence.{doctor,patient}:
// the time of each side's last check-in (startVideoCall, callHeartbeat
// every ~15 s), counted as present for PRESENCE_TTL_MS.
// In person: the patient has W from the start time; the doctor (or an
// admin) marks the no-show.
//
// The doctor can't make it (markDoctorUnavailable): reported by the doctor
// or an admin, or by the automatic job when the doctor's deadline passes.
// The booking is KEPT as a reschedule request (rescheduleRequest.byHospital)
// for an admin to give it a new time; the patient and admins are emailed
// and the patient may ask for a full refund instead. Meanwhile it can't be
// joined, marked a no-show or closed as completed. A refund closes it as
// "cancelled".
//
// Late reschedules (rescheduleCountsAsNoShow): a patient asking for a new
// time while the doctor is waiting for them (the deadline is the
// patient's), or after the start of a hospital visit, is treated as a
// no-show straight away (markNoShow byPatient), so the no-show fee
// applies. A reschedule asked for before the start protects the
// consultation from being marked a no-show.

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
// A side counts as in the room for this long after its last check-in
// (the call screen checks in every ~15 s).
const PRESENCE_TTL_MS = 45 * 1000;

/** Is `role` ("doctor" | "patient") in the video room now? */
function isPresent(c, role, now = Date.now()) {
  const seen = toDate(role === "doctor" ? c.presence?.doctor : c.presence?.patient)?.getTime();
  return Boolean(seen) && now - seen < PRESENCE_TTL_MS;
}

/**
 * Who must be in the room by when: { for: "doctor" | "patient", at (ms) },
 * or null (no deadline running: the consultation took place, or one side
 * is waiting for a countdown that hasn't been set yet).
 * In person: the patient, start + W.
 */
function waitDeadline(c, waitMinutes) {
  const start = toDate(c.scheduledTime)?.getTime();
  if (!start || c.metAt) return null;
  const wait = waitMinutes * 60 * 1000;
  if (c.mode !== "online") return { for: "patient", at: start + wait };
  if (c.waitDeadline?.for) {
    return { for: c.waitDeadline.for, at: toDate(c.waitDeadline.at).getTime() };
  }
  // Nobody has been in the room: the doctor has until start + W.
  if (!c.patientFirstJoinedAt && !c.doctorFirstJoinedAt) return { for: "doctor", at: start + wait };
  return null;
}

/** The deadline set when one side is in the room and the other isn't. */
function deadlineFrom(c, waitMinutes, now = Date.now()) {
  const start = toDate(c.scheduledTime).getTime();
  return Math.max(start, now) + waitMinutes * 60 * 1000;
}

/** True if a reschedule asked for now counts as a no-show (fee applies). */
function rescheduleCountsAsNoShow(c, waitMinutes, now = Date.now()) {
  const start = toDate(c.scheduledTime)?.getTime();
  if (!start || now < start || c.metAt) return false;
  // Online: only while the doctor is the one waiting (the deadline is the
  // patient's). If neither side is there, it's the doctor's no-show and
  // the patient's request stays free.
  if (c.mode === "online") return c.waitDeadline?.for === "patient";
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
    if (c.doctorUnavailable) {
      if (actor.role === "system") return null;
      throw new HttpsError("failed-precondition", "The doctor couldn't make this appointment, so it isn't a no-show.");
    }
    if (c.metAt) {
      throw new HttpsError("failed-precondition", "The patient and doctor were in the call together, so it isn't a no-show.");
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
      const d = waitDeadline(c, policy.waitMinutes);
      if (!d || d.for !== "patient" || isPresent(c, "patient")) {
        throw new HttpsError(
          "failed-precondition",
          "A no-show can only be marked once the doctor has waited in the call for the patient.",
        );
      }
      const deadline = d.at;
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
 * outcome: "completed" | "no_show" | "cancelled" (the doctor couldn't make
 * it and the patient took a refund)
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
    // A video call the two never actually had: the doctor can't close it as
    // completed (an admin still can, e.g. after a call by phone).
    if (outcome === "completed" && expectDoctorUid && c.mode === "online" && !c.metAt) {
      throw new HttpsError(
        "failed-precondition",
        "You and the patient were never connected in this call, so it can't be closed as completed.",
      );
    }
    // The doctor couldn't make it: it gets a new time, or a refund closes it.
    if (c.doctorUnavailable && outcome !== "cancelled") {
      throw new HttpsError(
        "failed-precondition",
        "The doctor couldn't make this appointment. Give it a new time, or the patient can ask for a refund.",
      );
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
      // Whether each side joined the video call (online only), and whether
      // they were ever connected together (met): a patient who met the
      // doctor can't ask for a refund (refunds.js).
      patientJoined: Boolean(c.patientFirstJoinedAt),
      doctorJoined: Boolean(c.doctorFirstJoinedAt),
      met: Boolean(c.metAt),
      doctorUnavailable: Boolean(c.doctorUnavailable),
      doctorUnavailableKind: c.doctorUnavailable?.kind || null,
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
      action:
        outcome === "no_show"
          ? "Closed a no-show consultation"
          : outcome === "cancelled"
            ? "Closed a consultation the doctor couldn't make (patient refunded)"
            : "Closed a consultation as completed",
      code:
        outcome === "no_show"
          ? "consultation.closed_no_show"
          : outcome === "cancelled"
            ? "consultation.closed_cancelled"
            : "consultation.closed",
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

/**
 * The consultation needs a new time because of the hospital's side:
 *   kind "doctor_absent"   the doctor can't make it / didn't come in time
 *                          (before the two were connected)
 *   kind "call_incomplete" they were connected but the call couldn't be
 *                          finished (reported by the doctor or an admin)
 * Either way the patient gets a free new time or a full refund.
 * actor: { uid, role } (doctor, admin, or "system" for the automatic job)
 * reason: optional note for the admin team; never shown to the patient and
 * kept out of the audit log (it may be personal).
 * expectDoctorUid: when a doctor acts, the consultation must be theirs.
 * Resolves { doctorUid, doctorName, scheduledTime, type, mode,
 * patientJoined, kind } if marked, or null if already marked (or, for the
 * system, no longer due).
 */
async function markDoctorUnavailable({
  consultationId,
  actor,
  kind = "doctor_absent",
  reason = null,
  meta = null,
  expectDoctorUid = null,
}) {
  const consultationRef = db.collection("consultations").doc(consultationId);
  const system = actor.role === "system";

  const marked = await db.runTransaction(async (tx) => {
    // deepcode ignore Sqli: Firestore document ID, not SQL; consultationId passed docId() in the callable or was read from Firestore by the job.
    const snap = await tx.get(consultationRef);
    if (!snap.exists) throw new HttpsError("not-found", "Consultation not found.");
    const c = snap.data();
    if (expectDoctorUid && c.doctorUid !== expectDoctorUid) {
      throw new HttpsError("not-found", "Consultation not found.");
    }
    if (c.doctorUnavailable) return null; // idempotent
    if (!["scheduled", "in_progress"].includes(c.status)) {
      if (system) return null;
      throw new HttpsError("failed-precondition", "This consultation is closed or was marked as a no-show.");
    }
    const incomplete = kind === "call_incomplete";
    if (incomplete && system) return null;
    if (incomplete && !c.metAt) {
      throw new HttpsError(
        "failed-precondition",
        "You and the patient were never connected in this call. Use \"I can't make it\" instead, or wait: the patient is marked as a no-show automatically if they don't come.",
      );
    }
    if (!incomplete && c.metAt) {
      if (system) return null;
      throw new HttpsError(
        "failed-precondition",
        "The call has already started. If it couldn't be finished, use \"Call couldn't be completed\".",
      );
    }
    // The automatic check: only if the doctor still isn't in the room.
    if (system && isPresent(c, "doctor")) return null;

    const bookingRef = db.collection("bookings").doc(c.bookingId);
    const [bookingSnap, refundSnap] = await Promise.all([
      // deepcode ignore Sqli: Firestore document ID, not SQL; bookingId read from the server-written consultation.
      tx.get(bookingRef),
      // deepcode ignore Sqli: Firestore document ID, not SQL; consultationId passed docId() or was read from Firestore.
      tx.get(db.collection("refundRequests").doc(consultationId)),
    ]);
    const booking = bookingSnap.exists ? bookingSnap.data() : null;
    if (refundSnap.exists) {
      if (system) return null;
      throw new HttpsError("failed-precondition", "The patient has asked for a refund for this consultation.");
    }
    // The patient asked for a new time before the start: they called it off
    // in good time, it's already in the admin's list, and the doctor isn't
    // at fault. (One asked for after the start, with the doctor absent too,
    // is still the doctor's no-show: rescheduleCountsAsNoShow.)
    const requestedAt = toDate(booking?.rescheduleRequest?.requestedAt)?.getTime();
    if (
      system &&
      booking?.rescheduleRequest?.status === "requested" &&
      !booking.rescheduleRequest.byHospital &&
      requestedAt &&
      requestedAt < toDate(c.scheduledTime).getTime()
    ) {
      return null;
    }

    const flag = { kind, at: Timestamp.now(), by: actor.role, byUid: actor.uid, reason: reason || null };
    tx.update(consultationRef, {
      status: "scheduled",
      doctorUnavailable: flag,
      waitDeadline: FieldValue.delete(),
      updatedAt: serverTime(),
    });
    if (booking) {
      // deepcode ignore Sqli: Firestore document ID, not SQL; bookingId read from the server-written consultation.
      tx.update(bookingRef, {
        doctorUnavailable: flag,
        rescheduleRequest: {
          status: "requested",
          byHospital: true,
          preferredTime: booking.rescheduleRequest?.preferredTime || null,
          reason: incomplete ? "The call couldn't be completed" : "The doctor couldn't make it",
          requestedAt: Timestamp.now(),
        },
        waitDeadline: FieldValue.delete(),
        updatedAt: serverTime(),
      });
      queueEmail(tx, {
        bookingId: c.bookingId,
        to: booking.email,
        kind: "patient_doctor_unavailable",
        data: {
          patientName: booking.guardianName || booking.patientName || "",
          doctorName: c.doctorName || "",
          type: c.type,
          mode: c.mode,
          scheduledAt: toDate(c.scheduledTime).getTime(),
          consultationId,
          amountPaid: Number(booking.amountPaid || 0),
          incomplete,
        },
        // Often sent after the start time (the automatic check), so not
        // the default "drop after the appointment time".
        sendBefore: Date.now() + 24 * 3600 * 1000,
      });
    }
    audit(tx, {
      actorId: actor.uid,
      actorRole: actor.role,
      action: incomplete
        ? "Reported that a video call couldn't be completed (patient told, sent for rescheduling)"
        : system
          ? "Doctor didn't join the video call in time (patient told, sent for rescheduling)"
          : actor.role === "doctor"
            ? "Doctor reported they can't make an appointment"
            : "Reported that the doctor can't make an appointment",
      code: incomplete ? "consultation.call_incomplete" : "consultation.doctor_unavailable",
      category: "consultation",
      targetType: "consultation",
      targetId: consultationId,
      patientUid: c.patientUid,
      meta,
    });
    return {
      doctorUid: c.doctorUid,
      doctorName: c.doctorName || "",
      scheduledTime: c.scheduledTime,
      type: c.type,
      mode: c.mode,
      patientJoined: Boolean(c.patientFirstJoinedAt),
      kind,
    };
  });

  if (marked) {
    await deleteTree(db.collection("calls").doc(consultationId)).catch((err) =>
      logger.warn("call cleanup after doctor unavailable failed", err),
    );
    await emailAdminsDoctorUnavailable({ consultationId, by: actor.role, ...marked }).catch((err) =>
      logger.warn("admin email (doctor unavailable) not queued", err),
    );
  }
  return marked;
}

/**
 * Tells every active admin that a doctor can't make an appointment, so a
 * new time is given quickly. No patient name in the email: admins open the
 * booking (by its reference) in Bookings -> Reschedule requests.
 */
async function emailAdminsDoctorUnavailable({
  consultationId,
  by,
  kind,
  doctorName,
  scheduledTime,
  type,
  mode,
  patientJoined,
}) {
  const admins = await db
    .collection("adminUsers")
    .where("role", "==", "admin")
    .where("status", "==", "active")
    .get();
  if (admins.empty) return;
  const batch = db.batch();
  for (const a of admins.docs) {
    queueEmail(batch, {
      to: a.data().email,
      kind: "admin_doctor_unavailable",
      data: {
        consultationId,
        by,
        kind,
        doctorName,
        type,
        mode,
        patientJoined,
        scheduledAt: toDate(scheduledTime).getTime(),
      },
      sendBefore: Date.now() + 24 * 3600 * 1000,
    });
  }
  await batch.commit();
}

module.exports = {
  PRESENCE_TTL_MS,
  isPresent,
  waitDeadline,
  deadlineFrom,
  rescheduleCountsAsNoShow,
  markNoShow,
  markDoctorUnavailable,
  closeConsultation,
  NO_SHOW_HOLD_DAYS,
};
