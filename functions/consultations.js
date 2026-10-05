// functions/consultations.js
//
//   startVideoCall       patient or doctor joins; the only way a call opens
//   getTurnCredentials   short-lived TURN relay credentials, participants only
//   markConsultationDone closes a consultation and erases the booking data
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
  oneOf,
  docId,
  toDate,
  audit,
  rateLimit,
  deleteTree,
  sha256,
} = require("./lib/core");
const { CALL_CONSENT_TEXT, CURRENT_CALL_CONSENT } = require("./lib/consentText");
const { verifyRoomDevice } = require("./roomDevices");

const CLOUDFLARE_TURN_KEY_ID = defineSecret("CLOUDFLARE_TURN_KEY_ID");
const CLOUDFLARE_TURN_API_TOKEN = defineSecret("CLOUDFLARE_TURN_API_TOKEN");

const JOIN_OPENS_MINUTES_BEFORE = 30;
const JOIN_CLOSES_HOURS_AFTER = 4;
const CALL_DOC_TTL_HOURS = 6;
// Share of the fee kept when the patient doesn't attend.
const NO_SHOW_FORFEIT = 0.2;

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
  await db.runTransaction(async (tx) => {
    const [callSnap, consultationSnap] = await Promise.all([tx.get(callRef), tx.get(ref)]);
    const current = consultationSnap.data();

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
      tx.update(db.collection("bookings").doc(current.bookingId), {
        callConsentId: consentRef.id,
      });
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

    // Who has joined decides what the patient can do afterwards: a patient
    // who joined can't ask for a refund, and a consultation both sides
    // joined can't be rescheduled. The booking carries a copy for the
    // patient's dashboard.
    const joinedField = caller.role === "doctor" ? "doctorFirstJoinedAt" : "patientFirstJoinedAt";
    const bookingJoinedField = caller.role === "doctor" ? "doctorJoinedAt" : "patientJoinedAt";
    const updates = { status: "in_progress", updatedAt: serverTime() };
    const bookingUpdates = {};
    if (!current.callStartedAt) {
      updates.callStartedAt = serverTime();
      bookingUpdates.callStartedAt = serverTime();
    }
    if (!current[joinedField]) {
      updates[joinedField] = serverTime();
      bookingUpdates[bookingJoinedField] = serverTime();
    }
    tx.update(ref, updates);
    if (Object.keys(bookingUpdates).length) {
      tx.update(db.collection("bookings").doc(current.bookingId), bookingUpdates);
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
 * the amount paid is read from the booking here.
 */
exports.markConsultationDone = onCall(async (request) => {
  const caller = await requireRole(request, ["doctor", "admin"]);
  const d = request.data || {};
  const consultationId = docId(d.consultationId, "Consultation");
  const outcome = oneOf(d.outcome, OUTCOMES, "outcome");

  const consultationRef = db.collection("consultations").doc(consultationId);
  const historyRef = db.collection("consultationHistory").doc(consultationId);
  const callRef = db.collection("calls").doc(consultationId);

  // Was recording expected for this call? Read before the shell goes.
  const callSnap = await callRef.get();
  const recordingExpected = callSnap.exists && callSnap.data().recordingEnabled === true;

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
    if (caller.role === "doctor" && c.doctorUid !== caller.uid) {
      throw new HttpsError("not-found", "Consultation not found.");
    }

    const bookingRef = db.collection("bookings").doc(c.bookingId);
    const bookingSnap = await tx.get(bookingRef);
    const booking = bookingSnap.exists ? bookingSnap.data() : {};
    const amountPaid = Number(booking.amountPaid ?? 0);

    let forfeitAmount = 0;
    let refundOwed = 0;
    if (outcome === "no_show") {
      forfeitAmount = Math.round(amountPaid * NO_SHOW_FORFEIT * 100) / 100;
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
      currency: booking.currency || "GHS",
      forfeitAmount,
      refundOwed,
      paystackReference: booking.paystackReference || null,
      closedByUid: caller.uid,
      closedByRole: caller.role,
      createdAt: serverTime(),
    });

    tx.delete(consultationRef);
    if (bookingSnap.exists) tx.delete(bookingRef);

    audit(tx, {
      actorId: caller.uid,
      actorRole: caller.role,
      action: outcome === "no_show" ? "Closed a consultation as a no-show" : "Closed a consultation as completed",
      code: outcome === "no_show" ? "consultation.no_show" : "consultation.closed",
      category: "consultation",
      targetType: "consultation",
      targetId: consultationId,
      patientUid: c.patientUid,
      details: refundOwed > 0 ? { refundOwed } : null,
      meta: requestMeta(request),
    });

    return { txRefs: booking.txRefs || [], patientUid: c.patientUid, forfeitAmount, refundOwed };
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

  // Doctors aren't shown payment figures; only admins get them back.
  return caller.role === "admin" && closed
    ? { consultationId, outcome, forfeitAmount: closed.forfeitAmount, refundOwed: closed.refundOwed }
    : { consultationId, outcome };
});
