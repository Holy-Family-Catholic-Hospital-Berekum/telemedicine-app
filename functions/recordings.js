// functions/recordings.js
//
// Call recording. Only an admin chooses the mode
// (systemSettings/features.callRecordingMode): "off", "video" (picture and
// sound) or "audio" (sound only). While it isn't off, every online call
// that starts records automatically in that mode; doctors and patients
// have no control over it. The mode is snapshotted per call.
//
//   setCallRecordingMode     admin chooses the mode (audited)
//   startRecording           doctor's browser asks to record; server decides
//   finalizeRecording        doctor's browser has uploaded every segment
//   getRecordingUrl          admin plays or downloads (reason required, audited)
//   requestRecordingDeletion admin asks to delete one recording, or every
//                            recording older than a date (audited)
//   decideDeletionRequest    a DIFFERENT admin approves (the deletion runs
//                            then) or rejects; requests expire after
//                            DELETION_REQUEST_HOURS
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
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const {
  onCall,
  admin,
  db,
  Timestamp,
  serverTime,
  HttpsError,
  RECORDING_MODES,
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

const MODE_LABEL = { off: "off", video: "video (picture and sound)", audio: "audio only" };

/** data: { mode: "off" | "video" | "audio" } */
exports.setCallRecordingMode = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const mode = request.data?.mode;
  if (!RECORDING_MODES.includes(mode)) {
    throw new HttpsError("invalid-argument", "Choose off, video or audio.");
  }
  const batch = db.batch();
  batch.set(
    featuresRef(),
    {
      callRecordingMode: mode,
      // Kept for older readers; true whenever recording is on.
      callRecordingEnabled: mode !== "off",
      updatedAt: serverTime(),
      updatedByUid: caller.uid,
    },
    { merge: true },
  );
  audit(batch, {
    actorId: caller.uid,
    actorRole: "admin",
    action: `Set call recording to ${MODE_LABEL[mode]}`,
    code: `recording.mode_${mode}`,
    category: "recording",
    targetType: "setting",
    targetId: "Call recording",
    meta: requestMeta(request),
  });
  await batch.commit();
  return { mode };
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
    const call = callSnap.data();
    if (call.recordingEnabled !== true) {
      return { recording: false };
    }
    // Calls started before modes existed were video.
    const mode = call.recordingMode === "audio" ? "audio" : "video";

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
      mode,
      mimeType: mode === "audio" ? "audio/webm" : "video/webm",
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
    return { recording: true, recordingId: ref.id, mode };
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
    contentType: rec.mimeType || "video/webm",
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
    // deepcode ignore Sqli: Firestore document ID, not SQL; consultationId read from the server-written recording.
    const callSnap = await tx.get(callRef);
    tx.update(recordingRef(recordingId), { status: "finalizing", updatedAt: serverTime() });
    // deepcode ignore Sqli: Firestore document ID, not SQL; consultationId read from the server-written recording.
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
      responseType: rec.mimeType || "video/webm",
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

/*
 * Two-admin rule: no single admin can delete recordings. One admin files a
 * request (deletionRequests/{id}, readable by admins), another approves it,
 * and only then are the files deleted. A request expires unapproved after
 * DELETION_REQUEST_HOURS. Every step is audited with both admins' IDs.
 */
const DELETION_REQUEST_HOURS = 72;

function finishedOnly(docs) {
  return docs.filter((doc) => !["recording", "finalizing"].includes(doc.data().status));
}

function olderThanQuery(before) {
  return db
    .collection("recordings")
    .where("startedAt", "<", Timestamp.fromDate(before))
    .orderBy("startedAt", "asc")
    .limit(MAX_BULK_DELETE);
}

/**
 * data: { kind: "single", recordingId, reason }
 *     | { kind: "before", before: ISO date, reason, dryRun?: boolean }
 * dryRun (before only) just returns how many recordings it would cover.
 */
exports.requestRecordingDeletion = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const d = request.data || {};
  const kind = d.kind === "before" ? "before" : "single";
  await rateLimit(caller.uid, "requestRecordingDeletion", { max: 30, windowSeconds: 3600 });

  let target;
  if (kind === "single") {
    const recordingId = docId(d.recordingId, "Recording");
    const snap = await recordingRef(recordingId).get();
    if (!snap.exists) throw new HttpsError("not-found", "Recording not found.");
    const rec = snap.data();
    if (["recording", "finalizing"].includes(rec.status)) {
      throw new HttpsError("failed-precondition", "This recording is still being saved.");
    }
    target = {
      recordingId,
      consultationId: rec.consultationId || null,
      startedAt: rec.startedAt || null,
      patientUid: rec.patientUid || null,
    };
  } else {
    const before = isoDateTime(d.before, "Date");
    if (before.getTime() > Date.now()) {
      throw new HttpsError("invalid-argument", "Choose a date in the past.");
    }
    const snap = await olderThanQuery(before).get();
    const count = finishedOnly(snap.docs).length;
    if (d.dryRun === true) return { count, capped: snap.size === MAX_BULK_DELETE };
    if (count === 0) throw new HttpsError("failed-precondition", "No finished recordings before that date.");
    target = { before: Timestamp.fromDate(before), count };
  }

  const reason = str(d.reason, { field: "Reason", max: 300, min: 3 });
  const ref = db.collection("deletionRequests").doc();
  await db.runTransaction(async (tx) => {
    if (kind === "single") {
      const dup = await tx.get(
        db.collection("deletionRequests")
          .where("status", "==", "pending")
          .where("target.recordingId", "==", target.recordingId)
          .limit(1),
      );
      if (!dup.empty) {
        throw new HttpsError("already-exists", "A deletion request for this recording is already waiting for approval.");
      }
    }
    tx.set(ref, {
      kind,
      target,
      reason,
      status: "pending",
      requestedByUid: caller.uid,
      requestedByName: caller.profile.name || null,
      createdAt: serverTime(),
      expiresAt: Timestamp.fromMillis(Date.now() + DELETION_REQUEST_HOURS * 3600 * 1000),
    });
    audit(tx, {
      actorId: caller.uid,
      actorRole: "admin",
      action: kind === "single"
        ? "Requested deletion of a call recording (needs a second admin)"
        : `Requested deletion of ${target.count} call recordings (needs a second admin)`,
      code: "recording.deletion_requested",
      category: "recording",
      targetType: "deletion_request",
      targetId: ref.id,
      patientUid: target.patientUid || null,
      reason,
      meta: requestMeta(request),
    });
  });
  return { requestId: ref.id };
});

/** data: { requestId, decision: "approve" | "reject", note? } */
exports.decideDeletionRequest = onCall({ timeoutSeconds: 540 }, async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const d = request.data || {};
  const requestId = docId(d.requestId, "Request");
  const approve = d.decision === "approve";
  const note = str(d.note, { field: "Note", max: 300, optional: true });
  const ref = db.collection("deletionRequests").doc(requestId);
  const meta = requestMeta(request);

  // Claim the request first, so two approvals can't both run it.
  const req = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Request not found.");
    const r = snap.data();
    if (r.status !== "pending") throw new HttpsError("failed-precondition", "This request has already been handled.");
    if ((r.expiresAt?.toMillis?.() ?? 0) < Date.now()) {
      tx.update(ref, { status: "expired", decidedAt: serverTime() });
      return { ...r, status: "expired" };
    }
    if (r.requestedByUid === caller.uid) {
      throw new HttpsError(
        "permission-denied",
        "Another admin must approve or reject a deletion you requested.",
      );
    }
    tx.update(ref, {
      status: approve ? "approved" : "rejected",
      decidedByUid: caller.uid,
      decidedByName: caller.profile.name || null,
      decisionNote: note,
      decidedAt: serverTime(),
    });
    if (!approve) {
      audit(tx, {
        actorId: caller.uid,
        actorRole: "admin",
        action: "Rejected a recording deletion request",
        code: "recording.deletion_rejected",
        category: "recording",
        targetType: "deletion_request",
        targetId: requestId,
        reason: note,
        details: { requestedByUid: r.requestedByUid },
        meta,
      });
    }
    return r;
  });
  if (req.status === "expired") {
    throw new HttpsError("failed-precondition", "This request expired. Ask for it again if it's still needed.");
  }
  if (!approve) return { status: "rejected" };

  // Approved: delete now. The audit entries are the certificate of
  // deletion (IDs and hashes, no content) and name both admins.
  const deleted = [];
  if (req.kind === "single") {
    const snap = await recordingRef(req.target.recordingId).get();
    if (snap.exists && !["recording", "finalizing"].includes(snap.data().status)) {
      deleted.push(await deleteOne(snap.id, snap.data()));
    }
  } else {
    const snap = await olderThanQuery(toDate(req.target.before)).get();
    for (const doc of finishedOnly(snap.docs)) {
      try {
        deleted.push(await deleteOne(doc.id, doc.data()));
      } catch (err) {
        logger.error("Approved bulk delete: one recording failed", { recordingId: doc.id, err });
      }
    }
  }
  await ref.update({ status: "done", deletedCount: deleted.length, doneAt: serverTime() });
  await audit(null, {
    actorId: caller.uid,
    actorRole: "admin",
    action: `Approved and carried out deletion of ${deleted.length} call recording${deleted.length === 1 ? "" : "s"}`,
    code: req.kind === "single" ? "recording.deleted" : "recording.bulk_deleted",
    category: "recording",
    targetType: "deletion_request",
    targetId: requestId,
    patientUid: req.target.patientUid || null,
    reason: req.reason,
    details: { requestedByUid: req.requestedByUid, approvedByUid: caller.uid, recordings: deleted },
    meta,
  });
  return { status: "done", deleted: deleted.length };
});
