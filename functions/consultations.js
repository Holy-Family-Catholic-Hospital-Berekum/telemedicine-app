// functions/consultations.js
//
//   startVideoCall       patient or doctor joins; the only way a call opens
//   getTurnCredentials   short-lived TURN relay credentials, participants only
//   markConsultationDone closes a consultation (completed) and erases the
//                        booking data, or marks a no-show (booking kept for
//                        a paid reschedule or a refund; see
//                        lib/consultationLifecycle.js)
//   reportDoctorUnavailable the doctor can't make it (or, kind
//                        "call_incomplete", the call couldn't be finished):
//                        patient and admins emailed, free new time or full
//                        refund
//   callHeartbeat        the call screen's check-in every ~15 s: who is in
//                        the room, whether the two are connected, the
//                        shared countdown (lib/consultationLifecycle.js)
//
// Video is peer-to-peer WebRTC. Signalling goes through calls/{consultationId},
// which only startVideoCall can create and which Security Rules open to the
// two named participants alone.
//
// Closing a consultation keeps a short history record (doctor, times,
// amount, outcome) and permanently deletes the booking, the consultation
// and the patient details they held. Recordings are separate and are kept
// until an admin deletes them.

const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const {
  onCall,
  db,
  FieldValue,
  Timestamp,
  serverTime,
  OUTCOMES,
  recordingModeOf,
  HttpsError,
  requireRole,
  requireVerifiedEmail,
  requestMeta,
  str,
  oneOf,
  docId,
  toDate,
  audit,
  rateLimit,
  sha256,
} = require("./lib/core");
const { CALL_CONSENT_TEXT, CURRENT_CALL_CONSENT } = require("./lib/consentText");
const { verifyRoomDevice } = require("./roomDevices");
const {
  markNoShow,
  markDoctorUnavailable,
  closeConsultation,
  waitDeadline,
  deadlineFrom,
  isPresent,
} = require("./lib/consultationLifecycle");
const { loadNoShowPolicy } = require("./siteSettings");
const { queueEmail } = require("./lib/mailQueue");

const CLOUDFLARE_TURN_KEY_ID = defineSecret("CLOUDFLARE_TURN_KEY_ID");
const CLOUDFLARE_TURN_API_TOKEN = defineSecret("CLOUDFLARE_TURN_API_TOKEN");

const JOIN_OPENS_MINUTES_BEFORE = 30;
const JOIN_CLOSES_HOURS_AFTER = 4;
const CALL_DOC_TTL_HOURS = 6;

async function currentRecordingMode() {
  const snap = await db.collection("systemSettings").doc("features").get();
  return recordingModeOf(snap.exists ? snap.data() : null);
}

/** Loads a consultation and checks the caller takes part in it. */
async function loadForParticipant(caller, consultationId) {
  const ref = db.collection("consultations").doc(consultationId);
  const snap = await ref.get();
  const c = snap.exists ? snap.data() : null;
  const isParty =
    c &&
    ((caller.role === "doctor" && c.doctorUid === caller.uid) ||
      (caller.role === "patient" && c.patientUid === caller.uid));
  if (!isParty) {
    // Same answer for "doesn't exist" and "not yours".
    throw new HttpsError("not-found", "Consultation not found.");
  }
  return { ref, consultation: c };
}

/** The call can't open: the doctor couldn't make it (or joined too late). */
function doctorUnavailableError(role) {
  return new HttpsError(
    "failed-precondition",
    role === "doctor"
      ? "This appointment has been passed to the hospital to reschedule, because you couldn't make it or didn't join in time. The patient has been told."
      : "Your doctor can't make this appointment. The hospital will email you a new time.",
  );
}

/* ------------------------------------------------------------------ */
/* startVideoCall                                                      */
/* ------------------------------------------------------------------ */

/**
 * Patient data: { consultationId, callConsentVersion? }
 * Doctor data:  { consultationId, roomDevice: { id, key } }
 *
 * Patients join with one click: the caller must be the signed-in,
 * verified patient booked on this consultation (loadForParticipant).
 * Doctors can only start or rejoin a call from a registered telemedicine
 * room computer (roomDevices.js), whose browser sends its device key.
 *
 * A patient's first join of each consultation must carry the current
 * video-consultation consent version; it's stored as a consent record and
 * later joins don't ask again.
 */
exports.startVideoCall = onCall(async (request) => {
  const caller = await requireRole(request, ["patient", "doctor"]);
  if (caller.role === "patient") requireVerifiedEmail(caller);
  const d = request.data || {};
  const consultationId = docId(d.consultationId, "Consultation");

  await rateLimit(caller.uid, "startVideoCall", { max: 30, windowSeconds: 3600 });

  const roomDeviceRef =
    caller.role === "doctor" ? await verifyRoomDevice(d.roomDevice) : null;

  const { ref, consultation } = await loadForParticipant(caller, consultationId);
  if (consultation.mode !== "online") {
    throw new HttpsError("failed-precondition", "This is an in-person consultation.");
  }
  if (!["scheduled", "in_progress"].includes(consultation.status)) {
    throw new HttpsError("failed-precondition", "This consultation is closed.");
  }
  if (consultation.doctorUnavailable) throw doctorUnavailableError(caller.role);
  const scheduled = toDate(consultation.scheduledTime);
  const now = Date.now();
  if (now < scheduled.getTime() - JOIN_OPENS_MINUTES_BEFORE * 60 * 1000) {
    throw new HttpsError(
      "failed-precondition",
      `The video room opens ${JOIN_OPENS_MINUTES_BEFORE} minutes before the scheduled time.`,
    );
  }
  if (now > scheduled.getTime() + JOIN_CLOSES_HOURS_AFTER * 3600 * 1000) {
    throw new HttpsError("failed-precondition", "The window for this call has passed.");
  }

  // Someone's waiting time is already up (the every-minute job may not
  // have run yet): settle it now, the same way the job would.
  const policy = await loadNoShowPolicy();
  await enforceDeadlineIfDue(consultationId, consultation, policy.waitMinutes, caller.role);

  const callRef = db.collection("calls").doc(consultationId);
  const recordingMode = await currentRecordingMode();
  const recordingEnabled = recordingMode !== "off";

  // Signalling protocol (see components/video/useWebRTCCall.js):
  // - The doctor always makes the WebRTC offer. A doctor (re)joining clears
  //   offer + answer, and the patient answers the doctor's fresh offer.
  // - Each patient (re)join bumps patientSeq and clears the answer. The
  //   doctor's browser sees the bump and makes a new offer tagged with that
  //   seq; the patient only answers an offer carrying its own seq, so it
  //   never answers a stale one.
  // ICE candidates are tagged with the offer/answer id they belong to, so
  // old ones are simply ignored.
  const expiresAt = Timestamp.fromMillis(now + CALL_DOC_TTL_HOURS * 3600 * 1000);
  let patientSeq = null;
  const bookingRef = db.collection("bookings").doc(consultation.bookingId);
  // deepcode ignore Sqli: Firestore document ID, not SQL; doctorUid read from the server-written consultation.
  const doctorRef = db.collection("adminUsers").doc(consultation.doctorUid);
  await db.runTransaction(async (tx) => {
    const [callSnap, consultationSnap, bookingSnap, doctorSnap] = await Promise.all([
      tx.get(callRef),
      tx.get(ref),
      tx.get(bookingRef),
      tx.get(doctorRef),
    ]);
    const current = consultationSnap.data();
    if (current.doctorUnavailable) throw doctorUnavailableError(caller.role);
    if (current.status === "no_show") throw noShowError(caller.role);

    // Video-consultation consent: once per consultation, before the
    // patient's first join.
    if (caller.role === "patient" && !current.callConsentId) {
      if (d.callConsentVersion !== CURRENT_CALL_CONSENT) {
        throw new HttpsError(
          "failed-precondition",
          "Please read and accept the video consultation consent before joining.",
          { reason: "call_consent_required", version: CURRENT_CALL_CONSENT },
        );
      }
      const meta = requestMeta(request);
      const consentRef = db.collection("consents").doc();
      tx.set(consentRef, {
        subjectUid: caller.uid,
        consentType: "video_consultation",
        action: "granted",
        context: "call_join",
        version: CURRENT_CALL_CONSENT,
        textSha256: sha256(CALL_CONSENT_TEXT[CURRENT_CALL_CONSENT]),
        consultationId,
        bookingId: current.bookingId,
        at: serverTime(),
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      tx.update(ref, { callConsentId: consentRef.id });
      tx.update(bookingRef, { callConsentId: consentRef.id });
    }

    if (!callSnap.exists) {
      patientSeq = caller.role === "patient" ? 1 : 0;
      tx.set(callRef, {
        doctorUid: consultation.doctorUid,
        patientUid: consultation.patientUid,
        // Snapshot of the admin switch at call start. Turning it off
        // mid-call doesn't stop a recording already running; turning it on
        // applies to calls that start afterwards.
        recordingEnabled,
        recordingMode,
        recordingActive: false,
        patientSeq,
        createdAt: serverTime(),
        expiresAt,
      });
    } else if (caller.role === "doctor") {
      tx.update(callRef, { offer: FieldValue.delete(), answer: FieldValue.delete(), expiresAt });
    } else {
      patientSeq = (callSnap.data().patientSeq || 0) + 1;
      tx.update(callRef, { patientSeq, answer: FieldValue.delete(), expiresAt });
    }

    // First joins are kept for the record (history, reminders); who is in
    // the room NOW (presence) and whether the two were connected (metAt)
    // decide the waiting rule (lib/consultationLifecycle.js).
    const joinedField = caller.role === "doctor" ? "doctorFirstJoinedAt" : "patientFirstJoinedAt";
    const bookingJoinedField = caller.role === "doctor" ? "doctorJoinedAt" : "patientJoinedAt";
    const updates = {
      status: "in_progress",
      [`presence.${caller.role}`]: Timestamp.fromMillis(now),
      updatedAt: serverTime(),
    };
    const bookingUpdates = {};
    if (!current.callStartedAt) {
      updates.callStartedAt = serverTime();
      bookingUpdates.callStartedAt = serverTime();
    }
    if (!current[joinedField]) {
      updates[joinedField] = serverTime();
      bookingUpdates[bookingJoinedField] = serverTime();
    }
    // Arriving: the other side's countdown starts now (or is cleared if
    // they're here).
    applyArrival({
      tx,
      c: current,
      me: caller.role,
      now,
      waitMinutes: policy.waitMinutes,
      updates,
      bookingUpdates,
      booking: bookingSnap.exists ? bookingSnap.data() : null,
      doctor: doctorSnap.exists ? doctorSnap.data() : null,
      consultationId,
      policy,
    });
    tx.update(ref, updates);
    if (Object.keys(bookingUpdates).length && bookingSnap.exists) {
      tx.update(bookingRef, bookingUpdates);
    }
    if (roomDeviceRef) {
      // deepcode ignore Sqli: Firestore document ID, not SQL; room device id checked against /^[A-Za-z0-9]{1,40}$/ in verifyRoomDevice.
      tx.update(roomDeviceRef, { lastUsedAt: serverTime(), lastUsedByUid: caller.uid });
    }
    audit(tx, {
      actorId: caller.uid,
      actorRole: caller.role,
      action: caller.role === "doctor" ? "Doctor joined a video call" : "Patient joined a video call",
      code: "consultation.joined",
      category: "consultation",
      targetType: "consultation",
      targetId: consultationId,
      patientUid: consultation.patientUid,
      meta: requestMeta(request),
    });
  });

  const fresh = (await ref.get()).data();
  return {
    consultationId,
    callStartedAt: toDate(fresh.callStartedAt)?.toISOString() ?? null,
    recordingEnabled,
    // The patient answers only offers carrying this number.
    ...(caller.role === "patient" ? { patientSeq } : {}),
    // The shared countdown both call screens show.
    waitDeadline: deadlineForClient(fresh, policy.waitMinutes),
  };
});

/** The patient's call is over because they were marked as a no-show. */
function noShowError(role) {
  return new HttpsError(
    "failed-precondition",
    role === "patient"
      ? "You didn't join in time, so this consultation was marked as missed. Open your dashboard to book a new time or ask for a refund."
      : "The patient didn't join in time, so this consultation was marked as a no-show.",
  );
}

/** { for, at (ms) } or null: the countdown shown on both call screens. */
function deadlineForClient(c, waitMinutes) {
  const dl = waitDeadline(c, waitMinutes);
  return dl ? { for: dl.for, at: dl.at } : null;
}

/**
 * If a waiting time is up and that side isn't in the room, settle it now,
 * as the every-minute job would (noShow.js). Resolves "doctor_unavailable",
 * "no_show" or null (nothing due).
 */
async function settleIfDue(consultationId, c, waitMinutes) {
  const dl = waitDeadline(c, waitMinutes);
  if (!dl || c.metAt || Date.now() < dl.at || isPresent(c, dl.for)) return null;
  const system = { uid: "system", role: "system" };
  if (dl.for === "doctor") {
    const marked = await markDoctorUnavailable({ consultationId, actor: system });
    if (!marked) return null;
    const { emailDoctorMissed } = require("./noShow");
    await emailDoctorMissed(marked, waitMinutes).catch(() => {});
    return "doctor_unavailable";
  }
  return (await markNoShow({ consultationId, actor: system }).catch(() => false)) ? "no_show" : null;
}

/** startVideoCall: a waiting time already up is settled, and the caller told. */
async function enforceDeadlineIfDue(consultationId, c, waitMinutes, callerRole) {
  const settled = await settleIfDue(consultationId, c, waitMinutes);
  if (settled === "doctor_unavailable") throw doctorUnavailableError(callerRole);
  if (settled === "no_show") throw noShowError(callerRole);
}

/**
 * One side has just come into the room (startVideoCall) or is still there
 * (callHeartbeat). Writes into `updates` / `bookingUpdates`:
 *   - the other side is here too: no countdown;
 *   - the other side isn't, and isn't already on a countdown: theirs
 *     starts now (max(start, now) + W), and they're emailed.
 * Arriving early counts as arriving at the start time.
 */
function applyArrival({ tx, c, me, now, waitMinutes, updates, bookingUpdates, booking, doctor, consultationId, policy }) {
  if (c.metAt) return;
  const other = me === "doctor" ? "patient" : "doctor";
  if (isPresent(c, other, now)) {
    if (c.waitDeadline) {
      updates.waitDeadline = FieldValue.delete();
      bookingUpdates.waitDeadline = FieldValue.delete();
    }
    return;
  }
  if (c.waitDeadline?.for === other) return; // already counting down
  const at = deadlineFrom(c, waitMinutes, now);
  const value = { for: other, at: Timestamp.fromMillis(at) };
  updates.waitDeadline = value;
  bookingUpdates.waitDeadline = value;
  queueWaitingEmail({ tx, c, forRole: other, at, booking, doctor, consultationId, policy });
}

/** "The other side is waiting for you: join before HH:MM." */
function queueWaitingEmail({ tx, c, forRole, at, booking, doctor, consultationId, policy }) {
  const base = {
    type: c.type,
    mode: c.mode,
    scheduledAt: toDate(c.scheduledTime).getTime(),
  };
  if (forRole === "patient" && booking?.email) {
    queueEmail(tx, {
      bookingId: c.bookingId,
      to: booking.email,
      kind: "patient_doctor_waiting",
      data: {
        ...base,
        patientName: booking.guardianName || booking.patientName || "",
        doctorName: c.doctorName || "",
        consultationId,
        noShowAt: at,
        noShow: policy,
      },
      sendBefore: at,
    });
  } else if (forRole === "doctor" && doctor?.email && doctor.status === "active") {
    queueEmail(tx, {
      to: doctor.email,
      kind: "doctor_not_joined",
      data: { ...base, doctorName: doctor.name || c.doctorName || "", otherJoined: true, by: at, noShow: policy },
      sendBefore: at,
    });
  }
}

/* ------------------------------------------------------------------ */
/* callHeartbeat                                                       */
/* ------------------------------------------------------------------ */

/**
 * data: { consultationId, connected?: boolean, leaving?: boolean }
 * Sent by the call screen every ~15 s while it's open, and once when the
 * person leaves. Records who is in the room, notices when the two are
 * actually connected (metAt: the consultation has taken place), starts
 * the countdown for a side that left, and tells the screen what's
 * happening:
 *   { state: "open" | "doctor_unavailable" | "no_show" | "closed",
 *     kind?, waitDeadline: { for, at } | null, otherPresent, met }
 */
exports.callHeartbeat = onCall(async (request) => {
  const caller = await requireRole(request, ["patient", "doctor"]);
  const d = request.data || {};
  const consultationId = docId(d.consultationId, "Consultation");
  const connected = d.connected === true;
  const leaving = d.leaving === true;
  await rateLimit(caller.uid, "callHeartbeat", { max: 600, windowSeconds: 3600 });

  let loaded;
  try {
    loaded = await loadForParticipant(caller, consultationId);
  } catch (err) {
    if (err?.code === "not-found") return { state: "closed" };
    throw err;
  }
  const { ref, consultation } = loaded;
  if (consultation.doctorUnavailable) {
    return { state: "doctor_unavailable", kind: consultation.doctorUnavailable.kind || "doctor_absent" };
  }
  if (consultation.status === "no_show") return { state: "no_show" };
  if (!["scheduled", "in_progress"].includes(consultation.status)) return { state: "closed" };

  const policy = await loadNoShowPolicy();
  // A countdown that has just run out is settled straight away, so the
  // screens don't wait for the every-minute job.
  const settled = leaving ? null : await settleIfDue(consultationId, consultation, policy.waitMinutes);
  if (settled === "doctor_unavailable") return { state: "doctor_unavailable", kind: "doctor_absent" };
  if (settled === "no_show") return { state: "no_show" };
  const me = caller.role;
  const other = me === "doctor" ? "patient" : "doctor";
  const bookingRef = db.collection("bookings").doc(consultation.bookingId);
  // deepcode ignore Sqli: Firestore document ID, not SQL; doctorUid read from the server-written consultation.
  const doctorRef = db.collection("adminUsers").doc(consultation.doctorUid);

  const result = await db.runTransaction(async (tx) => {
    const [snap, bookingSnap, doctorSnap] = await Promise.all([
      tx.get(ref),
      tx.get(bookingRef),
      tx.get(doctorRef),
    ]);
    if (!snap.exists) return { state: "closed" };
    const c = snap.data();
    if (c.doctorUnavailable || !["scheduled", "in_progress"].includes(c.status)) return null;
    const now = Date.now();
    const booking = bookingSnap.exists ? bookingSnap.data() : null;
    const doctor = doctorSnap.exists ? doctorSnap.data() : null;
    const updates = {};
    const bookingUpdates = {};
    const otherPresent = isPresent(c, other, now);

    if (leaving) {
      updates[`presence.${me}`] = FieldValue.delete();
      // Leaving while the other side waits (before the two were
      // connected): your countdown starts now.
      if (!c.metAt && otherPresent && c.waitDeadline?.for !== me) {
        const at = deadlineFrom(c, policy.waitMinutes, now);
        const value = { for: me, at: Timestamp.fromMillis(at) };
        updates.waitDeadline = value;
        bookingUpdates.waitDeadline = value;
        queueWaitingEmail({ tx, c, forRole: me, at, booking, doctor, consultationId, policy });
      }
    } else {
      updates[`presence.${me}`] = Timestamp.fromMillis(now);
      if (!c.metAt && connected && otherPresent) {
        // Both in the room and the video connected: it has taken place.
        updates.metAt = Timestamp.fromMillis(now);
        bookingUpdates.metAt = Timestamp.fromMillis(now);
        if (c.waitDeadline) {
          updates.waitDeadline = FieldValue.delete();
          bookingUpdates.waitDeadline = FieldValue.delete();
        }
      } else {
        applyArrival({
          tx,
          c,
          me,
          now,
          waitMinutes: policy.waitMinutes,
          updates,
          bookingUpdates,
          booking,
          doctor,
          consultationId,
          policy,
        });
      }
    }
    tx.update(ref, updates);
    if (Object.keys(bookingUpdates).length && bookingSnap.exists) tx.update(bookingRef, bookingUpdates);
    return { otherPresent };
  });

  if (result?.state) return result;
  const fresh = (await ref.get()).data();
  if (!fresh) return { state: "closed" };
  if (fresh.doctorUnavailable) {
    return { state: "doctor_unavailable", kind: fresh.doctorUnavailable.kind || "doctor_absent" };
  }
  if (fresh.status === "no_show") return { state: "no_show" };
  return {
    state: "open",
    waitDeadline: deadlineForClient(fresh, policy.waitMinutes),
    otherPresent: isPresent(fresh, other),
    met: Boolean(fresh.metAt),
  };
});

/* ------------------------------------------------------------------ */
/* getTurnCredentials                                                  */
/* ------------------------------------------------------------------ */

/** data: { consultationId } */
exports.getTurnCredentials = onCall(
  { secrets: [CLOUDFLARE_TURN_KEY_ID, CLOUDFLARE_TURN_API_TOKEN] },
  async (request) => {
    const caller = await requireRole(request, ["patient", "doctor"]);
    const consultationId = docId(request.data?.consultationId, "Consultation");
    await rateLimit(caller.uid, "getTurnCredentials", { max: 30, windowSeconds: 3600 });

    const { consultation } = await loadForParticipant(caller, consultationId);
    if (!["scheduled", "in_progress"].includes(consultation.status)) {
      throw new HttpsError("failed-precondition", "This consultation is closed.");
    }
    if (consultation.doctorUnavailable) throw doctorUnavailableError(caller.role);

    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${CLOUDFLARE_TURN_KEY_ID.value()}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_TURN_API_TOKEN.value()}`,
          "Content-Type": "application/json",
        },
        // One hour: longer than a consultation, short enough that a
        // credential lifted from dev tools is soon useless.
        body: JSON.stringify({ ttl: 3600 }),
      },
    );
    if (!response.ok) {
      logger.error("Cloudflare TURN request failed", { status: response.status });
      throw new HttpsError("unavailable", "Couldn't get relay credentials.");
    }
    const data = await response.json();
    // Cloudflare returns either one server object or an array. Browsers
    // block port 53, so drop those URLs (Cloudflare's own advice) to avoid
    // slow ICE timeouts.
    const servers = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
    const iceServers = servers
      .filter((s) => s && s.urls)
      .map((s) => ({
        ...s,
        urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter(
          (u) => typeof u === "string" && !/:53(\?|$)/.test(u),
        ),
      }))
      .filter((s) => s.urls.length > 0);
    if (iceServers.length === 0) {
      throw new HttpsError("unavailable", "Couldn't get relay credentials.");
    }
    return { iceServers };
  },
);

/* ------------------------------------------------------------------ */
/* reportCaptureAttempt                                                */
/* ------------------------------------------------------------------ */

/**
 * data: { consultationId, method }. The call screen reports a screenshot
 * or screen-recording shortcut pressed during a consultation. Browsers
 * can't block capture outright, so these are logged for the hospital to
 * follow up (audit tab), alongside the on-screen watermark and warning.
 */
exports.reportCaptureAttempt = onCall(async (request) => {
  const caller = await requireRole(request, ["patient", "doctor"]);
  const consultationId = docId(request.data?.consultationId, "Consultation");
  const method = oneOf(request.data?.method, ["print_screen", "screenshot_shortcut", "record_shortcut"], "method");
  await rateLimit(caller.uid, "reportCaptureAttempt", { max: 20, windowSeconds: 3600 });
  const { consultation } = await loadForParticipant(caller, consultationId);
  await audit(null, {
    actorId: caller.uid,
    actorRole: caller.role,
    action: caller.role === "doctor"
      ? "Doctor tried to capture a video consultation"
      : "Patient tried to capture a video consultation",
    code: "consultation.capture_attempt",
    category: "security",
    result: "failed",
    targetType: "consultation",
    targetId: consultationId,
    patientUid: consultation.patientUid,
    details: { method },
    meta: requestMeta(request),
  });
  return { ok: true };
});

/* ------------------------------------------------------------------ */
/* markConsultationDone                                                */
/* ------------------------------------------------------------------ */

/**
 * data: { consultationId, outcome: "completed" | "no_show" }
 * The assigned doctor or an admin. The client never sends an amount:
 * the amount paid is read from the booking here. A doctor may mark a
 * no-show only for a hospital visit: video calls are marked by
 * autoMarkNoShows (from the call's own join records), so a doctor can't
 * mark one by mistake for a patient who joined.
 */
exports.markConsultationDone = onCall(async (request) => {
  const caller = await requireRole(request, ["doctor", "admin"]);
  const d = request.data || {};
  const consultationId = docId(d.consultationId, "Consultation");
  const outcome = oneOf(d.outcome, OUTCOMES, "outcome");
  if (caller.role === "doctor" && outcome === "no_show") {
    // deepcode ignore Sqli: Firestore document ID, not SQL; consultationId passed docId() (/^[A-Za-z0-9_-]+$/).
    const snap = await db.collection("consultations").doc(consultationId).get();
    if (snap.exists && snap.data().doctorUid === caller.uid && snap.data().mode !== "in_person") {
      throw new HttpsError(
        "permission-denied",
        "Video calls are marked as a no-show automatically when the patient doesn't join in time.",
      );
    }
  }
  const actor = { uid: caller.uid, role: caller.role };
  const expectDoctorUid = caller.role === "doctor" ? caller.uid : null;
  const meta = requestMeta(request);

  // A no-show keeps the booking so the patient can reschedule (with the
  // no-show fee) or ask for a refund; it can only be marked once the
  // patient's waiting time is over (lib/consultationLifecycle.js).
  // An admin can close a held no-show early with { close: true } (the
  // patient's booking details are then deleted, as after the hold).
  if (outcome === "no_show" && !(d.close === true && caller.role === "admin")) {
    await markNoShow({ consultationId, actor, meta, expectDoctorUid });
    return { consultationId, outcome };
  }

  const closed = await closeConsultation({ consultationId, outcome, actor, meta, expectDoctorUid });
  // Doctors aren't shown payment figures; only admins get them back.
  return caller.role === "admin" && closed
    ? { consultationId, outcome, forfeitAmount: closed.forfeitAmount, refundOwed: closed.refundOwed }
    : { consultationId, outcome };
});

/* ------------------------------------------------------------------ */
/* reportDoctorUnavailable                                             */
/* ------------------------------------------------------------------ */

/**
 * data: { consultationId, reason?, kind?: "doctor_absent" | "call_incomplete" }
 * The assigned doctor, or an admin, says the doctor can't make this
 * appointment (or that the call, once connected, couldn't be finished). The patient is emailed; the booking goes to the admin's
 * reschedule requests, and the patient may ask for a full refund instead
 * (lib/consultationLifecycle.js markDoctorUnavailable). `reason` is for the
 * admin team only.
 */
exports.reportDoctorUnavailable = onCall(async (request) => {
  const caller = await requireRole(request, ["doctor", "admin"]);
  const d = request.data || {};
  const consultationId = docId(d.consultationId, "Consultation");
  const reason = str(d.reason, { field: "Reason", max: 300, optional: true });
  const kind = d.kind === "call_incomplete" ? "call_incomplete" : "doctor_absent";
  await rateLimit(caller.uid, "reportDoctorUnavailable", { max: 30, windowSeconds: 3600 });

  // deepcode ignore Sqli: Firestore document ID, not SQL; consultationId passed docId() (/^[A-Za-z0-9_-]+$/).
  const marked = await markDoctorUnavailable({
    consultationId,
    actor: { uid: caller.uid, role: caller.role },
    kind,
    reason,
    meta: requestMeta(request),
    expectDoctorUid: caller.role === "doctor" ? caller.uid : null,
  });
  return { consultationId, marked: Boolean(marked) };
});
