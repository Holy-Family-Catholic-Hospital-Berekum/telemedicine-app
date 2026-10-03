// functions/recordings.js
//
// Call recording. Only an admin can switch it on or off
// (systemSettings/features.callRecordingEnabled). While it is on, every
// online call that starts records automatically; doctors and patients
// have no control over it.
//
//   setCallRecordingEnabled  admin flips the switch (audited)
//   startRecording           doctor's browser asks to record; server decides
//   finalizeRecording        doctor's browser has uploaded every segment
//   getRecordingUrl          admin plays or downloads (reason required, audited)
//   deleteRecording          admin deletes one recording (audited)
//   deleteRecordingsBefore   admin deletes everything older than a date
//   recoverStaleRecordings   hourly: finishes recordings a crash left open
//
// How a recording is made: the doctor's browser composites both video
// feeds and mixes both audio tracks, and uploads a segment every
// SEGMENT_SECONDS to recordings/{recordingId}/parts/NNNNNN.webm. Storage
// rules let only the assigned doctor create parts, only while the metadata
// says "recording", and nobody can read, overwrite or delete them. At the
// end the server stitches the parts into recording.webm, hashes it
// (SHA-256) and records size and storage generation, so later tampering is
// detectable. A crash loses seconds, not the call.
//
// Playback and download use V4 signed URLs that expire in 10 minutes. The
// functions' service account needs "Service Account Token Creator" on
// itself for that (see the deploy notes).

const crypto = require("crypto");
const { onCall } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const {
  admin,
  db,
  Timestamp,
  serverTime,
  HttpsError,
  requireRole,
  requestMeta,
  str,
  docId,
  isoDateTime,
  toDate,
  audit,
  rateLimit,
} = require("./lib/core");

const URL_TTL_MS = 10 * 60 * 1000;
const STALE_RECORDING_HOURS = 3;
const STALE_FINALIZING_MINUTES = 60;
const MAX_BULK_DELETE = 500;

const bucket = () => admin.storage().bucket();
const featuresRef = () => db.collection("systemSettings").doc("features");
const recordingRef = (id) => db.collection("recordings").doc(id);
const partsPrefix = (id) => `recordings/${id}/parts/`;
const finalPath = (id) => `recordings/${id}/recording.webm`;

/* ------------------------------------------------------------------ */
/* the admin switch                                                    */
/* ------------------------------------------------------------------ */

/** data: { enabled: boolean } */
exports.setCallRecordingEnabled = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const enabled = request.data?.enabled;
  if (typeof enabled !== "boolean") {
    throw new HttpsError("invalid-argument", "Choose on or off.");
  }
  const batch = db.batch();
  batch.set(
    featuresRef(),
    { callRecordingEnabled: enabled, updatedAt: serverTime(), updatedByUid: caller.uid },
    { merge: true },
  );
  audit(batch, {
    actorId: caller.uid,
    actorRole: "admin",
    action: enabled ? "Switched call recording on" : "Switched call recording off",
    code: enabled ? "recording.switch_on" : "recording.switch_off",
    category: "recording",
    targetType: "setting",
    targetId: "Call recording",
    meta: requestMeta(request),
  });
  await batch.commit();
  return { enabled };
});

/* ------------------------------------------------------------------ */
/* startRecording                                                      */
/* ------------------------------------------------------------------ */

/**
 * data: { consultationId }
 * Returns { recording: false } when the switch was off at call start,
 * otherwise { recording: true, recordingId }.
 */
exports.startRecording = onCall(async (request) => {
  const caller = await requireRole(request, ["doctor"]);
  const consultationId = docId(request.data?.consultationId, "Consultation");
  await rateLimit(caller.uid, "startRecording", { max: 20, windowSeconds: 3600 });

  const consultationRef = db.collection("consultations").doc(consultationId);
  const callRef = db.collection("calls").doc(consultationId);
  const ref = db.collection("recordings").doc();
  const meta = requestMeta(request);

  const result = await db.runTransaction(async (tx) => {
    const [cSnap, callSnap] = await Promise.all([tx.get(consultationRef), tx.get(callRef)]);
    const c = cSnap.exists ? cSnap.data() : null;
    if (!c || c.doctorUid !== caller.uid) {
      throw new HttpsError("not-found", "Consultation not found.");
    }
    if (c.status !== "in_progress" || !callSnap.exists) {
      throw new HttpsError("failed-precondition", "The call hasn't started.");
    }
    if (callSnap.data().recordingEnabled !== true) {
      return { recording: false };
    }

    tx.set(ref, {
      consultationId,
      patientUid: c.patientUid,
      patientName: c.patientName || null,
      doctorUid: c.doctorUid,
      doctorName: c.doctorName || null,
      consultationType: c.type,
      scheduledTime: c.scheduledTime,
      status: "recording",
      startedAt: serverTime(),
      endedAt: null,
      durationSec: null,
      partCount: 0,
      storagePath: null,
      sizeBytes: null,
      mimeType: "video/webm",
      integrity: null,
      client: { userAgent: meta.userAgent },
      createdAt: serverTime(),
      updatedAt: serverTime(),
    });
    tx.update(callRef, { recordingActive: true });
    audit(tx, {
      actorId: caller.uid,
      actorRole: "doctor",
      action: "Call recording started",
      code: "recording.started",
      category: "recording",
      targetType: "recording",
      targetId: ref.id,
      patientUid: c.patientUid,
      meta,
    });
    return { recording: true, recordingId: ref.id };
  });

  return result;
});

/* ------------------------------------------------------------------ */
/* composing and hashing                                               */
/* ------------------------------------------------------------------ */

function sha256OfFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    file
      .createReadStream()
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Stitches the uploaded parts (in name order) into recording.webm, hashes
 * it, deletes the parts and marks the document `finalStatus`. Parts from
 * one MediaRecorder session concatenate into a valid WebM file.
 */
async function composeRecording(recordingId, finalStatus) {
  const ref = recordingRef(recordingId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const rec = snap.data();

  const [parts] = await bucket().getFiles({ prefix: partsPrefix(recordingId) });
  parts.sort((a, b) => a.name.localeCompare(b.name));

  // The last segment's upload time is when recording really stopped (the
  // recovery job may run hours later).
  const lastUpload = parts.length ? Date.parse(parts[parts.length - 1].metadata?.timeCreated) : NaN;
  const endedAt = Number.isFinite(lastUpload) ? Timestamp.fromMillis(lastUpload) : Timestamp.now();
  const durationSec = rec.startedAt
    ? Math.max(0, Math.round((endedAt.toMillis() - rec.startedAt.toMillis()) / 1000))
    : null;

  if (parts.length === 0) {
    await ref.update({ status: "failed", endedAt, durationSec, updatedAt: serverTime() });
    await audit(null, {
      action: "Call recording failed: no video arrived",
      code: "recording.failed",
      category: "recording",
      result: "failed",
      targetType: "recording",
      targetId: recordingId,
      patientUid: rec.patientUid,
    });
    return;
  }

  // GCS compose takes at most 32 sources; the destination may be one of
  // them, so append in batches of 31.
  const dest = bucket().file(finalPath(recordingId));
  await bucket().combine(parts.slice(0, 32), dest);
  for (let i = 32; i < parts.length; i += 31) {
    await bucket().combine([dest, ...parts.slice(i, i + 31)], dest);
  }
  await dest.setMetadata({
    contentType: "video/webm",
    // Lets the file be re-attached to its record even without Firestore.
    metadata: {
      recordingId,
      consultationId: rec.consultationId,
      patientUid: rec.patientUid,
      doctorUid: rec.doctorUid,
    },
  });

  const sha256 = await sha256OfFile(dest);
  const [metadata] = await dest.getMetadata();

  await ref.update({
    status: finalStatus,
    storagePath: finalPath(recordingId),
    partCount: parts.length,
    sizeBytes: Number(metadata.size),
    integrity: {
      sha256,
      storageGeneration: String(metadata.generation),
      verifiedAt: serverTime(),
    },
    endedAt,
    durationSec,
    updatedAt: serverTime(),
  });

  await Promise.all(parts.map((p) => p.delete({ ignoreNotFound: true }).catch(() => {})));

  await audit(null, {
    action: finalStatus === "partial" ? "Recovered a partial call recording" : "Call recording saved",
    code: "recording.finalized",
    category: "recording",
    targetType: "recording",
    targetId: recordingId,
    patientUid: rec.patientUid,
    details: { sha256, parts: parts.length },
  });
}

/** Moves recording -> finalizing exactly once; returns false if not ours to do. */
async function claimForFinalizing(recordingId, expectDoctorUid) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(recordingRef(recordingId));
    if (!snap.exists) return false;
    const rec = snap.data();
    if (expectDoctorUid && rec.doctorUid !== expectDoctorUid) {
      throw new HttpsError("not-found", "Recording not found.");
    }
    if (rec.status !== "recording") return false;
    // All reads before any write.
    const callRef = db.collection("calls").doc(rec.consultationId);
    const callSnap = await tx.get(callRef);
    tx.update(recordingRef(recordingId), { status: "finalizing", updatedAt: serverTime() });
    if (callSnap.exists) tx.update(callRef, { recordingActive: false });
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* finalizeRecording                                                   */
/* ------------------------------------------------------------------ */

/** data: { recordingId } */
exports.finalizeRecording = onCall(
  { timeoutSeconds: 540, memory: "1GiB" },
  async (request) => {
    const caller = await requireRole(request, ["doctor"]);
    const recordingId = docId(request.data?.recordingId, "Recording");
    const claimed = await claimForFinalizing(recordingId, caller.uid);
    if (claimed) await composeRecording(recordingId, "available");
    return { ok: true };
  },
);

/* ------------------------------------------------------------------ */
/* recoverStaleRecordings (scheduled)                                  */
/* ------------------------------------------------------------------ */

exports.recoverStaleRecordings = onSchedule(
  { schedule: "every 60 minutes", timeoutSeconds: 540, memory: "1GiB" },
  async () => {
    const now = Date.now();
    const stale = await db
      .collection("recordings")
      .where("status", "==", "recording")
      .where("startedAt", "<", Timestamp.fromMillis(now - STALE_RECORDING_HOURS * 3600 * 1000))
      .limit(20)
      .get();
    for (const doc of stale.docs) {
      try {
        if (await claimForFinalizing(doc.id, null)) {
          await composeRecording(doc.id, "partial");
        }
      } catch (err) {
        logger.error("Recovering recording failed", { recordingId: doc.id, err });
      }
    }

    // A finalize that crashed half-way.
    const stuck = await db
      .collection("recordings")
      .where("status", "==", "finalizing")
      .where("updatedAt", "<", Timestamp.fromMillis(now - STALE_FINALIZING_MINUTES * 60 * 1000))
      .limit(20)
      .get();
    for (const doc of stuck.docs) {
      try {
        await composeRecording(doc.id, "partial");
      } catch (err) {
        logger.error("Re-finalizing recording failed", { recordingId: doc.id, err });
      }
    }
  },
);

/* ------------------------------------------------------------------ */
/* getRecordingUrl                                                     */
/* ------------------------------------------------------------------ */

/** data: { recordingId, purpose: "play" | "download", reason } */
exports.getRecordingUrl = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const d = request.data || {};
  const recordingId = docId(d.recordingId, "Recording");
  const purpose = d.purpose === "download" ? "download" : "play";
  const reason = str(d.reason, { field: "Reason", max: 300, min: 3 });
  await rateLimit(caller.uid, "getRecordingUrl", { max: 60, windowSeconds: 3600 });

  const snap = await recordingRef(recordingId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Recording not found.");
  const rec = snap.data();
  if (!["available", "partial"].includes(rec.status) || !rec.storagePath) {
    throw new HttpsError("failed-precondition", "This recording isn't ready.");
  }

  const started = toDate(rec.startedAt);
  const filename = `consultation-${rec.consultationId}-${started ? started.toISOString().slice(0, 10) : "recording"}.webm`;
  const [url] = await bucket()
    .file(rec.storagePath)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + URL_TTL_MS,
      responseType: "video/webm",
      responseDisposition:
        purpose === "download" ? `attachment; filename="${filename}"` : "inline",
    });

  await audit(null, {
    actorId: caller.uid,
    actorRole: "admin",
    action: purpose === "download" ? "Downloaded a call recording" : "Played a call recording",
    code: purpose === "download" ? "recording.downloaded" : "recording.accessed",
    category: "recording",
    targetType: "recording",
    targetId: recordingId,
    patientUid: rec.patientUid,
    reason,
    meta: requestMeta(request),
  });

  return { url, expiresInSeconds: URL_TTL_MS / 1000, filename };
});

/* ------------------------------------------------------------------ */
/* deletion                                                            */
/* ------------------------------------------------------------------ */

async function deleteOne(recordingId, rec) {
  await bucket().deleteFiles({ prefix: `recordings/${recordingId}/`, force: true });
  await recordingRef(recordingId).delete();
  return {
    recordingId,
    consultationId: rec.consultationId,
    sha256: rec.integrity?.sha256 || null,
  };
}

/** data: { recordingId, reason } */
exports.deleteRecording = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const recordingId = docId(request.data?.recordingId, "Recording");
  const reason = str(request.data?.reason, { field: "Reason", max: 300, min: 3 });

  const snap = await recordingRef(recordingId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Recording not found.");
  const rec = snap.data();
  if (["recording", "finalizing"].includes(rec.status)) {
    throw new HttpsError("failed-precondition", "This recording is still being saved.");
  }

  const gone = await deleteOne(recordingId, rec);
  // The entry is the certificate of deletion: IDs and hash, no content.
  await audit(null, {
    actorId: caller.uid,
    actorRole: "admin",
    action: "Deleted a call recording",
    code: "recording.deleted",
    category: "recording",
    targetType: "recording",
    targetId: recordingId,
    patientUid: rec.patientUid,
    reason,
    details: gone,
    meta: requestMeta(request),
  });
  return { deleted: 1 };
});

/**
 * data: { before: ISO date, reason, dryRun?: boolean }
 * Deletes finished recordings that started before `before`. Call with
 * dryRun first to show the admin how many will go.
 */
exports.deleteRecordingsBefore = onCall(
  { timeoutSeconds: 540 },
  async (request) => {
    const caller = await requireRole(request, ["admin"]);
    const d = request.data || {};
    const before = isoDateTime(d.before, "Date");
    if (before.getTime() > Date.now()) {
      throw new HttpsError("invalid-argument", "Choose a date in the past.");
    }
    const query = db
      .collection("recordings")
      .where("startedAt", "<", Timestamp.fromDate(before))
      .orderBy("startedAt", "asc")
      .limit(MAX_BULK_DELETE);

    const snap = await query.get();
    const finished = snap.docs.filter(
      (doc) => !["recording", "finalizing"].includes(doc.data().status),
    );

    if (d.dryRun === true) {
      return { count: finished.length, capped: snap.size === MAX_BULK_DELETE };
    }

    const reason = str(d.reason, { field: "Reason", max: 300, min: 3 });
    const deleted = [];
    for (const doc of finished) {
      try {
        deleted.push(await deleteOne(doc.id, doc.data()));
      } catch (err) {
        logger.error("Bulk delete: one recording failed", { recordingId: doc.id, err });
      }
    }
    await audit(null, {
      actorId: caller.uid,
      actorRole: "admin",
      action: `Deleted ${deleted.length} call recordings older than ${before.toISOString().slice(0, 10)}`,
      code: "recording.bulk_deleted",
      category: "recording",
      targetType: "recording",
      targetId: `before ${before.toISOString().slice(0, 10)}`,
      reason,
      details: { recordings: deleted },
      meta: requestMeta(request),
    });
    return { deleted: deleted.length, capped: snap.size === MAX_BULK_DELETE };
  },
);
