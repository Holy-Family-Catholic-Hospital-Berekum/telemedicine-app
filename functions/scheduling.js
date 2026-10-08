// functions/scheduling.js
//
// Admin scheduling, open slots and reschedules.
//
//   scheduleConsultation   admin assigns doctor + time to a paid booking
//   createAvailableSlot    admin opens a bookable slot for a doctor
//   cancelAvailableSlot    admin withdraws an open slot
//   requestReschedule      patient asks to move a scheduled consultation
//   rescheduleConsultation admin applies (or declines) a reschedule
//
// The patient and the doctor are emailed about each change (lib/mailQueue.js,
// sent by email.js once a verified sending domain is set); reminders before
// the appointment come from reminders.js.

const {
  onCall,
  db,
  FieldValue,
  Timestamp,
  serverTime,
  TYPES,
  MODES,
  HttpsError,
  requireRole,
  requireVerifiedEmail,
  requestMeta,
  str,
  oneOf,
  docId,
  isoDateTime,
  toDate,
  newConsultationId,
  audit,
  rateLimit,
  deleteTree,
} = require("./lib/core");
const { queueEmail } = require("./lib/mailQueue");
const { loadNoShowPolicy } = require("./siteSettings");
const { PAYSTACK_SECRET_KEY } = require("./lib/paystack");
const { markNoShow, rescheduleCountsAsNoShow } = require("./lib/consultationLifecycle");

// A doctor can't have two consultations closer together than this.
const MIN_GAP_MINUTES = 30;
const MAX_DAYS_AHEAD = 180;
const MAX_RESCHEDULES = 10;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Reads (inside `tx`) and checks an active, listed doctor for `type`. */
async function activeDoctor(tx, doctorUid, type) {
  const [staffSnap, profileSnap] = await Promise.all([
    // deepcode ignore Sqli: Firestore document ID, not SQL; doctorUid passed docId() (/^[A-Za-z0-9_-]+$/) or was read from a server-written doc.
    tx.get(db.collection("adminUsers").doc(doctorUid)),
    // deepcode ignore Sqli: Firestore document ID, not SQL; doctorUid passed docId() (/^[A-Za-z0-9_-]+$/) or was read from a server-written doc.
    tx.get(db.collection("doctorProfiles").doc(doctorUid)),
  ]);
  const staff = staffSnap.exists ? staffSnap.data() : null;
  const profile = profileSnap.exists ? profileSnap.data() : null;
  if (!staff || staff.role !== "doctor" || staff.status !== "active") {
    throw new HttpsError("failed-precondition", "That doctor isn't active.");
  }
  if (type && !(profile?.availableFor || []).includes(type)) {
    throw new HttpsError(
      "failed-precondition",
      "That doctor doesn't take this consultation type.",
    );
  }
  return {
    name: staff.name || profile?.name || "Doctor",
    department: staff.department || profile?.roleTitle || null,
    email: staff.email || null,
  };
}

/** True once both the patient and the doctor have joined the video call. */
const bothJoined = (c) => Boolean(c.patientFirstJoinedAt && c.doctorFirstJoinedAt);

function checkFutureTime(date) {
  const now = Date.now();
  if (date.getTime() < now - 5 * 60 * 1000) {
    throw new HttpsError("invalid-argument", "Choose a time in the future.");
  }
  if (date.getTime() > now + MAX_DAYS_AHEAD * 86400 * 1000) {
    throw new HttpsError("invalid-argument", "That time is too far ahead.");
  }
}

/** Throws if the doctor already has a consultation near `when`. */
async function assertNoClash(tx, doctorUid, when, ignoreConsultationId) {
  // deepcode ignore Sqli: Firestore document ID, not SQL; doctorUid passed docId() (/^[A-Za-z0-9_-]+$/); this is an equality filter.
  const snap = await tx.get(
    db
      .collection("consultations")
      .where("doctorUid", "==", doctorUid)
      .where("status", "in", ["scheduled", "in_progress"]),
  );
  const gap = MIN_GAP_MINUTES * 60 * 1000;
  const clash = snap.docs.find((d) => {
    if (d.id === ignoreConsultationId) return false;
    const t = toDate(d.data().scheduledTime);
    return t && Math.abs(t.getTime() - when.getTime()) < gap;
  });
  if (clash) {
    throw new HttpsError(
      "failed-precondition",
      `That doctor already has a consultation within ${MIN_GAP_MINUTES} minutes of this time.`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* scheduleConsultation                                                */
/* ------------------------------------------------------------------ */

/** data: { bookingId, doctorUid, scheduledTime (ISO) } */
exports.scheduleConsultation = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const d = request.data || {};
  const bookingId = docId(d.bookingId, "Booking");
  const doctorUid = docId(d.doctorUid, "Doctor");
  const when = isoDateTime(d.scheduledTime, "Time");
  checkFutureTime(when);

  const bookingRef = db.collection("bookings").doc(bookingId);
  const noShow = await loadNoShowPolicy();

  const consultationId = await db.runTransaction(async (tx) => {
    const bookingSnap = await tx.get(bookingRef);
    if (!bookingSnap.exists) throw new HttpsError("not-found", "Booking not found.");
    const booking = bookingSnap.data();
    if (booking.status !== "paid" || booking.consultationId) {
      throw new HttpsError(
        "failed-precondition",
        "Only paid bookings that aren't scheduled yet can be scheduled.",
      );
    }

    const doctor = await activeDoctor(tx, doctorUid, booking.type);
    await assertNoClash(tx, doctorUid, when, null);

    // Collisions are astronomically unlikely, but checking is cheap.
    let id = newConsultationId();
    for (let i = 0; i < 3; i++) {
      const existing = await tx.get(db.collection("consultations").doc(id));
      if (!existing.exists) break;
      id = newConsultationId();
    }

    const scheduledTime = Timestamp.fromDate(when);
    tx.set(db.collection("consultations").doc(id), {
      bookingId,
      patientUid: booking.patientUid,
      patientName: booking.patientName || null,
      // A child's parent or guardian (the account holder), if any.
      guardianName: booking.guardianName || null,
      // What the doctor needs to see. Deleted when the consultation closes.
      patientDetails: {
        dateOfBirth: booking.dateOfBirth,
        sex: booking.sex,
        location: booking.location,
      },
      doctorUid,
      doctorName: doctor.name,
      type: booking.type,
      mode: booking.mode,
      scheduledTime,
      status: "scheduled",
      callStartedAt: null,
      // When the patient and doctor were told the time (reminders.js).
      scheduleSetAt: Timestamp.now(),
      rescheduleHistory: [],
      createdAt: serverTime(),
      createdByUid: caller.uid,
      updatedAt: serverTime(),
    });
    tx.update(bookingRef, {
      status: "scheduled",
      consultationId: id,
      doctorUid,
      doctorName: doctor.name,
      doctorDepartment: doctor.department,
      scheduledTime,
      updatedAt: serverTime(),
    });
    // Tell the patient and the doctor by email (sent by functions/email.js).
    queueEmail(tx, {
      bookingId,
      to: booking.email,
      kind: "appointment_scheduled",
      data: {
        patientName: booking.guardianName || booking.patientName || "",
        doctorName: doctor.name,
        type: booking.type,
        mode: booking.mode,
        scheduledAt: when.getTime(),
        consultationId: id,
        noShow,
        payAtHospital: booking.payAtHospital === true,
        amountDue: booking.payAtHospital ? booking.amount : null,
      },
    });
    queueEmail(tx, {
      to: doctor.email,
      kind: "doctor_assigned",
      data: { doctorName: doctor.name, type: booking.type, mode: booking.mode, scheduledAt: when.getTime(), noShow },
    });
    audit(tx, {
      actorId: caller.uid,
      actorRole: "admin",
      action: "Scheduled a consultation",
      code: "booking.scheduled",
      category: "booking",
      targetType: "consultation",
      targetId: id,
      patientUid: booking.patientUid,
      meta: requestMeta(request),
    });
    return id;
  });

  return { consultationId };
});

/* ------------------------------------------------------------------ */
/* slots                                                               */
/* ------------------------------------------------------------------ */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** data: { doctorUid, type, mode, date: YYYY-MM-DD, startTime: HH:MM, endTime: HH:MM } */
exports.createAvailableSlot = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const d = request.data || {};
  const doctorUid = docId(d.doctorUid, "Doctor");
  const type = oneOf(d.type, TYPES, "consultation type");
  const mode = oneOf(d.mode, MODES, "mode");
  if (!DATE_RE.test(d.date || "") || !TIME_RE.test(d.startTime || "") || !TIME_RE.test(d.endTime || "")) {
    throw new HttpsError("invalid-argument", "Enter a valid date and times.");
  }
  // Ghana is UTC+0 all year, so the admin's wall-clock time is UTC.
  const startAt = new Date(`${d.date}T${d.startTime}:00Z`);
  const endAt = new Date(`${d.date}T${d.endTime}:00Z`);
  if (Number.isNaN(startAt.getTime()) || endAt <= startAt) {
    throw new HttpsError("invalid-argument", "End time must be after start time.");
  }
  if (endAt - startAt > 12 * 3600 * 1000) {
    throw new HttpsError("invalid-argument", "A slot can't be longer than 12 hours.");
  }
  checkFutureTime(startAt);

  const ref = db.collection("availableSlots").doc();
  await db.runTransaction(async (tx) => {
    const doctor = await activeDoctor(tx, doctorUid, type);
    // deepcode ignore Sqli: Firestore document ID, not SQL; doctorUid passed docId(); date matched DATE_RE (YYYY-MM-DD).
    const sameDay = await tx.get(
      db
        .collection("availableSlots")
        .where("doctorUid", "==", doctorUid)
        .where("date", "==", d.date),
    );
    const overlap = sameDay.docs.some((s) => {
      const x = s.data();
      if (x.status === "cancelled") return false;
      return toDate(x.startAt) < endAt && startAt < toDate(x.endAt);
    });
    if (overlap) {
      throw new HttpsError("failed-precondition", "This overlaps an existing slot for that doctor.");
    }
    tx.set(ref, {
      doctorUid,
      doctorName: doctor.name,
      type,
      mode,
      date: d.date,
      startTime: d.startTime,
      endTime: d.endTime,
      startAt: Timestamp.fromDate(startAt),
      endAt: Timestamp.fromDate(endAt),
      status: "open",
      // No createdByUid: open slots are public, and the audit entry below
      // already records which admin opened it.
      createdAt: serverTime(),
      updatedAt: serverTime(),
    });
    audit(tx, {
      actorId: caller.uid,
      actorRole: "admin",
      action: "Opened an available slot",
      code: "slot.created",
      category: "booking",
      targetType: "slot",
      targetId: ref.id,
      meta: requestMeta(request),
    });
  });
  return { slotId: ref.id };
});

/** data: { slotId } */
exports.cancelAvailableSlot = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const slotId = docId(request.data?.slotId, "Slot");
  const ref = db.collection("availableSlots").doc(slotId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Slot not found.");
    if (snap.data().status !== "open") {
      throw new HttpsError(
        "failed-precondition",
        "Only open slots can be cancelled. This one is being booked.",
      );
    }
    tx.update(ref, { status: "cancelled", updatedAt: serverTime() });
    audit(tx, {
      actorId: caller.uid,
      actorRole: "admin",
      action: "Cancelled an available slot",
      code: "slot.cancelled",
      category: "booking",
      targetType: "slot",
      targetId: slotId,
      meta: requestMeta(request),
    });
  });
  return { ok: true };
});

/* ------------------------------------------------------------------ */
/* reschedules                                                         */
/* ------------------------------------------------------------------ */

/** data: { bookingId, preferredTime?, reason? } */
// Before the start: a free request for the hospital to move it. From the
// start on (patient not joined, doctor not to blame): it counts as a
// no-show and the patient pays the no-show fee (lib/consultationLifecycle.js
// rescheduleCountsAsNoShow); resolves like startNoShowReschedule then:
// { status: "pay", ... } or { status: "requested" }.
exports.requestReschedule = onCall({ secrets: [PAYSTACK_SECRET_KEY] }, async (request) => {
  const caller = await requireRole(request, ["patient"]);
  const d = request.data || {};
  const bookingId = docId(d.bookingId, "Booking");
  const preferredTime = str(d.preferredTime, { field: "Preferred time", max: 80, optional: true });
  const reason = str(d.reason, { field: "Reason", max: 300, optional: true });

  await rateLimit(caller.uid, "requestReschedule", { max: 5, windowSeconds: 86400 });

  const ref = db.collection("bookings").doc(bookingId);
  const policy = await loadNoShowPolicy();
  const meta = requestMeta(request);
  const late = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().patientUid !== caller.uid) {
      throw new HttpsError("not-found", "Booking not found.");
    }
    const booking = snap.data();
    if (booking.status !== "scheduled" || !booking.consultationId) {
      throw new HttpsError("failed-precondition", "This booking isn't scheduled yet.");
    }
    const [consultationSnap, refundSnap] = await Promise.all([
      // deepcode ignore Sqli: Firestore document ID, not SQL; consultationId read from the patient's server-written booking.
      tx.get(db.collection("consultations").doc(booking.consultationId)),
      // deepcode ignore Sqli: Firestore document ID, not SQL; consultationId read from the patient's server-written booking.
      tx.get(db.collection("refundRequests").doc(booking.consultationId)),
    ]);
    // A missed consultation can be moved: one the patient, or the doctor,
    // never joined.
    if (bothJoined(consultationSnap.data() || {})) {
      throw new HttpsError("failed-precondition", "This consultation has already taken place.");
    }
    if (refundSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "You've asked for a refund for this consultation, so it can't be rescheduled.",
      );
    }
    // Too late for a free reschedule (a request made before the start
    // still stands and can be updated).
    // (Free hospital visits have no fee: always a plain request.)
    if (
      !booking.payAtHospital &&
      booking.rescheduleRequest?.status !== "requested" &&
      rescheduleCountsAsNoShow(consultationSnap.data() || {}, policy.waitMinutes)
    ) {
      return booking.consultationId;
    }
    tx.update(ref, {
      rescheduleRequest: {
        status: "requested",
        preferredTime,
        reason,
        requestedAt: Timestamp.now(),
        // The doctor couldn't make it: the patient is only adding a time
        // that suits them to the hospital's own request.
        ...(booking.doctorUnavailable ? { byHospital: true } : {}),
      },
      updatedAt: serverTime(),
    });
    audit(tx, {
      actorId: caller.uid,
      actorRole: "patient",
      action: "Requested a reschedule",
      code: "booking.reschedule_requested",
      category: "booking",
      targetType: "consultation",
      targetId: booking.consultationId,
      patientUid: caller.uid,
      meta,
    });
    return null;
  });

  if (late) {
    requireVerifiedEmail(caller); // a payment follows
    await markNoShow({
      consultationId: late,
      actor: { uid: caller.uid, role: "patient" },
      meta,
      byPatient: true,
    });
    const { beginNoShowReschedule } = require("./noShow");
    return beginNoShowReschedule({ caller, bookingId, preferredTime, reason, meta });
  }
  return { requested: true, status: "requested" };
});

/**
 * data: { bookingId, scheduledTime?, doctorUid?, decline?: true, reason? }
 * Applies a new time (and optionally a different doctor), or declines the
 * pending request.
 */
exports.rescheduleConsultation = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const d = request.data || {};
  const bookingId = docId(d.bookingId, "Booking");
  const decline = d.decline === true;
  const note = str(d.reason, { field: "Reason", max: 300, optional: true });

  const bookingRef = db.collection("bookings").doc(bookingId);
  const noShow = await loadNoShowPolicy();

  const moved = await db.runTransaction(async (tx) => {
    const bookingSnap = await tx.get(bookingRef);
    if (!bookingSnap.exists) throw new HttpsError("not-found", "Booking not found.");
    const booking = bookingSnap.data();
    if (booking.status !== "scheduled" || !booking.consultationId) {
      throw new HttpsError("failed-precondition", "This booking isn't scheduled.");
    }

    if (decline) {
      if (booking.doctorUnavailable) {
        throw new HttpsError(
          "failed-precondition",
          "The doctor couldn't make this appointment, so it needs a new time (or the patient can ask for a refund).",
        );
      }
      tx.update(bookingRef, {
        "rescheduleRequest.status": "declined",
        updatedAt: serverTime(),
      });
      audit(tx, {
        actorId: caller.uid,
        actorRole: "admin",
        action: "Declined a reschedule request",
        code: "booking.reschedule_declined",
        category: "booking",
        targetType: "consultation",
        targetId: booking.consultationId,
        patientUid: booking.patientUid,
        meta: requestMeta(request),
      });
      return null;
    }

    const when = isoDateTime(d.scheduledTime, "Time");
    checkFutureTime(when);
    const doctorUid = d.doctorUid ? docId(d.doctorUid, "Doctor") : booking.doctorUid;

    const consultationRef = db.collection("consultations").doc(booking.consultationId);
    const [consultationSnap, refundSnap] = await Promise.all([
      // deepcode ignore Sqli: Firestore document ID, not SQL; consultationId read from the server-written booking.
      tx.get(consultationRef),
      // deepcode ignore Sqli: Firestore document ID, not SQL; consultationId read from the server-written booking.
      tx.get(db.collection("refundRequests").doc(booking.consultationId)),
    ]);
    if (!consultationSnap.exists) throw new HttpsError("not-found", "Consultation not found.");
    // A refund and a reschedule exclude each other (a declined one doesn't count).
    if (refundSnap.exists && refundSnap.data().status !== "declined") {
      throw new HttpsError(
        "failed-precondition",
        "The patient has asked for a refund for this consultation. Resolve it in Refunds first.",
      );
    }
    const consultation = consultationSnap.data();
    // A call one side never joined was missed, and can be moved.
    if (bothJoined(consultation)) {
      throw new HttpsError("failed-precondition", "This consultation has already taken place.");
    }
    if ((consultation.rescheduleHistory || []).length >= MAX_RESCHEDULES) {
      throw new HttpsError("failed-precondition", "This consultation has been rescheduled too many times.");
    }

    const doctor = await activeDoctor(tx, doctorUid, booking.type);
    await assertNoClash(tx, doctorUid, when, booking.consultationId);
    const previousDoctorSnap =
      consultation.doctorUid && consultation.doctorUid !== doctorUid
        // deepcode ignore Sqli: Firestore document ID, not SQL; doctorUid read from the server-written consultation.
        ? await tx.get(db.collection("adminUsers").doc(consultation.doctorUid))
        : null;

    const scheduledTime = Timestamp.fromDate(when);
    const entry = {
      from: consultation.scheduledTime,
      to: scheduledTime,
      reason: note || booking.rescheduleRequest?.reason || "",
      byUid: caller.uid,
      at: Timestamp.now(),
    };
    // A missed call starts again from scratch at the new time: nobody has
    // joined, and the reminders go out again. Call consent is kept.
    // deepcode ignore Sqli: Firestore document ID, not SQL; consultationId read from the server-written booking.
    tx.update(consultationRef, {
      scheduledTime,
      doctorUid,
      doctorName: doctor.name,
      status: "scheduled",
      callStartedAt: null,
      patientFirstJoinedAt: FieldValue.delete(),
      doctorFirstJoinedAt: FieldValue.delete(),
      doctorUnavailable: FieldValue.delete(),
      reminders: FieldValue.delete(),
      scheduleSetAt: Timestamp.now(),
      rescheduleHistory: [...(consultation.rescheduleHistory || []), entry],
      updatedAt: serverTime(),
    });
    tx.update(bookingRef, {
      scheduledTime,
      doctorUid,
      doctorName: doctor.name,
      doctorDepartment: doctor.department,
      callStartedAt: null,
      patientJoinedAt: FieldValue.delete(),
      doctorJoinedAt: FieldValue.delete(),
      doctorUnavailable: FieldValue.delete(),
      ...(booking.rescheduleRequest ? { "rescheduleRequest.status": "applied" } : {}),
      updatedAt: serverTime(),
    });
    queueEmail(tx, {
      bookingId,
      to: booking.email,
      kind: "appointment_rescheduled",
      data: {
        patientName: booking.guardianName || booking.patientName || "",
        doctorName: doctor.name,
        type: booking.type,
        mode: booking.mode,
        scheduledAt: when.getTime(),
        consultationId: booking.consultationId,
        noShow,
        payAtHospital: booking.payAtHospital === true,
        amountDue: booking.payAtHospital ? booking.amount : null,
        // The new time after the doctor couldn't make it: says sorry.
        afterDoctorUnavailable: Boolean(booking.doctorUnavailable),
      },
    });
    queueEmail(tx, {
      to: doctor.email,
      kind: previousDoctorSnap ? "doctor_assigned" : "doctor_rescheduled",
      data: { doctorName: doctor.name, type: booking.type, mode: booking.mode, scheduledAt: when.getTime(), noShow },
    });
    if (previousDoctorSnap?.exists) {
      const was = toDate(consultation.scheduledTime);
      queueEmail(tx, {
        to: previousDoctorSnap.data().email,
        kind: "doctor_unassigned",
        data: {
          doctorName: previousDoctorSnap.data().name || "",
          type: booking.type,
          mode: booking.mode,
          scheduledAt: was ? was.getTime() : when.getTime(),
        },
        sendBefore: Date.now() + 86400 * 1000,
      });
    }
    audit(tx, {
      actorId: caller.uid,
      actorRole: "admin",
      action: "Rescheduled a consultation",
      code: "booking.rescheduled",
      category: "booking",
      targetType: "consultation",
      targetId: booking.consultationId,
      patientUid: booking.patientUid,
      meta: requestMeta(request),
    });
    return booking.consultationId;
  });

  // A missed call's signalling is cleared so the new time starts fresh.
  if (moved) {
    await deleteTree(db.collection("calls").doc(moved)).catch(() => {});
  }
  return { ok: true };
});
