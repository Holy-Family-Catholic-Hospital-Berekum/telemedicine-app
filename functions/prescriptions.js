// functions/prescriptions.js
//
// Prescriptions written by the doctor after a video consultation, which
// the patient downloads as the hospital's signed prescription form (PDF).
// The rules (video only, after the two met, 24 h, one per consultation,
// 7 days) are in lib/prescriptions.js; the form in lib/prescriptionPdf.js.
//
//   updatePrescriberDetails  doctor: MDC registration number and drawn
//                            signature (needs a fresh sign-in; audited)
//   issuePrescription        doctor: writes the prescription for their
//                            consultation
//   cancelPrescription       doctor: voids it (the check page says so)
//   getPrescriptionPdf       the patient (or the doctor) downloads the form
//   checkPrescription        anyone with the code from the QR: valid,
//                            expired or cancelled, doctor, dates, medicines
//   deleteExpiredPrescriptions  hourly: deletes them after 7 days, keeping
//                            only an audit line (no medicines)
//
// Data: prescriptions/{id} (the patient and the doctor read their own;
// admins don't), prescriptionSignatures/{id} (the signature as it was when
// issued; no client access), doctorSignatures/{uid} (the doctor's current
// signature; only they can read it). The patient's age and sex are copied
// from the consultation when it's issued, because closing the consultation
// deletes them.

const logger = require("firebase-functions/logger");
const {
  onCall,
  db,
  Timestamp,
  serverTime,
  HttpsError,
  requireRole,
  requireVerifiedEmail,
  requestMeta,
  str,
  docId,
  toDate,
  audit,
  rateLimit,
  sha256,
} = require("./lib/core");
const { task } = require("./lib/task");
const {
  VALID_DAYS,
  newPrescriptionId,
  newCheckCode,
  normaliseCheckCode,
  validatePrescription,
  cannotIssueReason,
  mdcNumber,
  signaturePng,
  requireFreshSignIn,
  ageText,
} = require("./lib/prescriptions");

const rxRef = (id) => db.collection("prescriptions").doc(id);
const rxSignatureRef = (id) => db.collection("prescriptionSignatures").doc(id);
const doctorSignatureRef = (uid) => db.collection("doctorSignatures").doc(uid);

/* ------------------------------------------------------------------ */
/* updatePrescriberDetails                                             */
/* ------------------------------------------------------------------ */

/**
 * data: { mdcNumber?, signature? (base64 PNG) }
 * What the doctor's prescriptions are signed with. The doctor confirms
 * with their password and authenticator code first (a sign-in under 5
 * minutes old), so someone at an unlocked computer can't change it.
 * Prescriptions already issued keep the signature they were issued with.
 */
exports.updatePrescriberDetails = onCall(async (request) => {
  const caller = await requireRole(request, ["doctor"]);
  requireFreshSignIn(caller.token);
  const d = request.data || {};
  const mdc = d.mdcNumber !== undefined ? mdcNumber(d.mdcNumber) : null;
  const signature = d.signature !== undefined ? signaturePng(d.signature) : null;
  if (!mdc && !signature) {
    throw new HttpsError("invalid-argument", "Nothing to save.");
  }
  await rateLimit(caller.uid, "updatePrescriberDetails", { max: 10, windowSeconds: 86400 });

  const batch = db.batch();
  if (mdc) {
    batch.update(db.collection("adminUsers").doc(caller.uid), { mdcNumber: mdc, updatedAt: serverTime() });
  }
  if (signature) {
    batch.set(doctorSignatureRef(caller.uid), {
      png: signature.png,
      sha256: signature.sha256,
      updatedAt: serverTime(),
    });
  }
  audit(batch, {
    actorId: caller.uid,
    actorRole: caller.role,
    action: "Changed their prescription signature or MDC number",
    code: "doctor.prescriber_changed",
    category: "account",
    targetType: "user",
    targetId: caller.uid,
    details: {
      mdcNumber: Boolean(mdc),
      signature: Boolean(signature),
      ...(signature ? { signatureSha256: signature.sha256 } : {}),
    },
    meta: requestMeta(request),
  });
  await batch.commit();
  return { ok: true, mdcNumber: mdc || caller.profile.mdcNumber || null, signature: Boolean(signature) };
});

/* ------------------------------------------------------------------ */
/* issuePrescription                                                   */
/* ------------------------------------------------------------------ */

/**
 * data: { consultationId, items: [{ medicine, strength?, form?, dose,
 * frequency, duration, quantity? }], notes? }
 * The consultation's own doctor, with an MDC number and a signature on
 * file. Resolves { prescriptionId }.
 */
exports.issuePrescription = onCall(async (request) => {
  const caller = await requireRole(request, ["doctor"]);
  const d = request.data || {};
  const consultationId = docId(d.consultationId, "Consultation");
  const { items, notes } = validatePrescription(d);
  if (!caller.profile.mdcNumber) {
    throw new HttpsError(
      "failed-precondition",
      "Add your MDC registration number in the Account tab before writing prescriptions.",
    );
  }
  await rateLimit(caller.uid, "issuePrescription", { max: 60, windowSeconds: 86400 });

  const consultationRef = db.collection("consultations").doc(consultationId);
  const id = newPrescriptionId();
  const meta = requestMeta(request);

  await db.runTransaction(async (tx) => {
    const [snap, sigSnap] = await Promise.all([
      tx.get(consultationRef),
      tx.get(doctorSignatureRef(caller.uid)),
    ]);
    const c = snap.exists ? snap.data() : null;
    if (!c || c.doctorUid !== caller.uid) {
      throw new HttpsError("not-found", "Consultation not found.");
    }
    const reason = cannotIssueReason(c);
    if (reason) throw new HttpsError("failed-precondition", reason);
    if (!sigSnap.exists || !sigSnap.data().png) {
      throw new HttpsError(
        "failed-precondition",
        "Draw your signature in the Account tab before writing prescriptions.",
      );
    }
    const now = Date.now();
    const issuedAt = Timestamp.fromMillis(now);
    const expiresAt = Timestamp.fromMillis(now + VALID_DAYS * 86400 * 1000);

    tx.create(rxRef(id), {
      consultationId,
      patientUid: c.patientUid,
      doctorUid: caller.uid,
      status: "active",
      checkCode: newCheckCode(),
      // As printed on the form (copied now: closing the consultation
      // deletes the patient's details).
      patientName: c.patientName || null,
      guardianName: c.guardianName || null,
      patientAge: ageText(c.patientDetails),
      patientSex: c.patientDetails?.sex || null,
      doctorName: caller.profile.name || c.doctorName || null,
      doctorDepartment: caller.profile.department || null,
      doctorMdcNumber: caller.profile.mdcNumber,
      consultationType: c.type || null,
      consultedAt: c.metAt,
      items,
      notes,
      issuedAt,
      expiresAt,
    });
    tx.create(rxSignatureRef(id), {
      png: sigSnap.data().png,
      sha256: sigSnap.data().sha256 || null,
      expiresAt,
    });
    tx.update(consultationRef, {
      prescription: { id, status: "active", issuedAt },
      updatedAt: serverTime(),
    });
    audit(tx, {
      actorId: caller.uid,
      actorRole: caller.role,
      action: "Issued a prescription",
      code: "prescription.issued",
      category: "consultation",
      targetType: "prescription",
      targetId: id,
      patientUid: c.patientUid,
      details: { consultationId, medicines: items.length },
      meta,
    });
  });
  return { prescriptionId: id };
});

/* ------------------------------------------------------------------ */
/* cancelPrescription                                                  */
/* ------------------------------------------------------------------ */

/**
 * data: { prescriptionId, reason? }
 * The doctor who issued it. It can't be edited or written again: the
 * check page and the patient's dashboard show it as cancelled.
 */
exports.cancelPrescription = onCall(async (request) => {
  const caller = await requireRole(request, ["doctor"]);
  const d = request.data || {};
  const id = docId(d.prescriptionId, "Prescription");
  const reason = str(d.reason, { field: "Reason", max: 200, optional: true });
  await rateLimit(caller.uid, "cancelPrescription", { max: 30, windowSeconds: 86400 });

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(rxRef(id));
    const rx = snap.exists ? snap.data() : null;
    if (!rx || rx.doctorUid !== caller.uid) {
      throw new HttpsError("not-found", "Prescription not found.");
    }
    if (rx.status === "cancelled") return;
    const consultationRef = db.collection("consultations").doc(rx.consultationId);
    const consultationSnap = await tx.get(consultationRef);
    tx.update(snap.ref, {
      status: "cancelled",
      cancelledAt: serverTime(),
      // Shown to the patient; kept out of the audit log.
      cancelReason: reason,
    });
    if (consultationSnap.exists) {
      tx.update(consultationRef, { "prescription.status": "cancelled", updatedAt: serverTime() });
    }
    audit(tx, {
      actorId: caller.uid,
      actorRole: caller.role,
      action: "Cancelled a prescription",
      code: "prescription.cancelled",
      category: "consultation",
      targetType: "prescription",
      targetId: id,
      patientUid: rx.patientUid,
      details: { consultationId: rx.consultationId },
      meta: requestMeta(request),
    });
  });
  return { ok: true };
});

/* ------------------------------------------------------------------ */
/* getPrescriptionPdf                                                  */
/* ------------------------------------------------------------------ */

/**
 * data: { prescriptionId }
 * The patient it was written for (or the doctor who wrote it), while it's
 * valid. Resolves { fileName, pdf (base64) }.
 */
exports.getPrescriptionPdf = onCall({ memory: "512MiB" }, async (request) => {
  const caller = await requireRole(request, ["patient", "doctor"]);
  if (caller.role === "patient") requireVerifiedEmail(caller);
  const id = docId(request.data?.prescriptionId, "Prescription");
  await rateLimit(caller.uid, "getPrescriptionPdf", { max: 30, windowSeconds: 3600 });

  const snap = await rxRef(id).get();
  const rx = snap.exists ? snap.data() : null;
  const owner = rx && (caller.role === "patient" ? rx.patientUid : rx.doctorUid) === caller.uid;
  if (!owner) throw new HttpsError("not-found", "Prescription not found.");
  if (rx.status === "cancelled") {
    throw new HttpsError("failed-precondition", "This prescription was cancelled by the doctor.");
  }
  if (toDate(rx.expiresAt).getTime() <= Date.now()) {
    throw new HttpsError("failed-precondition", "This prescription has expired.");
  }
  const sigSnap = await rxSignatureRef(id).get();
  // Lazy: pdfkit is only loaded by the functions that build a form.
  const { buildPrescriptionPdf } = require("./lib/prescriptionPdf");
  const pdf = await buildPrescriptionPdf(
    { ...rx, id, issuedAt: toDate(rx.issuedAt), expiresAt: toDate(rx.expiresAt) },
    sigSnap.exists ? sigSnap.data().png : null,
  );
  await audit(null, {
    actorId: caller.uid,
    actorRole: caller.role,
    action: "Downloaded a prescription",
    code: "prescription.downloaded",
    category: "consultation",
    targetType: "prescription",
    targetId: id,
    patientUid: rx.patientUid,
    meta: requestMeta(request),
  });
  return { fileName: `Prescription-${id}.pdf`, pdf: pdf.toString("base64") };
});

/* ------------------------------------------------------------------ */
/* checkPrescription                                                   */
/* ------------------------------------------------------------------ */

/**
 * data: { code } (from the QR code or typed in). No sign-in: pharmacists
 * use it. The code is ~99 random bits, so only someone holding the form
 * can look one up. Never returns the patient's name or details.
 */
exports.checkPrescription = onCall(async (request) => {
  const meta = requestMeta(request);
  const caller = request.auth?.uid || `ip-${sha256(String(meta.ip || "unknown")).slice(0, 16)}`;
  await rateLimit(caller, "checkPrescription", { max: 60, windowSeconds: 3600 });
  const code = normaliseCheckCode(request.data?.code);
  if (!code) return { status: "not_found" };

  // deepcode ignore Sqli: Firestore equality filter on a code checked against a fixed alphabet, not SQL.
  const found = await db.collection("prescriptions").where("checkCode", "==", code).limit(1).get();
  if (found.empty) return { status: "not_found" };
  const rx = found.docs[0].data();
  const expiresAt = toDate(rx.expiresAt).getTime();
  const status = rx.status === "cancelled" ? "cancelled" : expiresAt <= Date.now() ? "expired" : "valid";
  return {
    status,
    reference: found.docs[0].id,
    issuedAt: toDate(rx.issuedAt).getTime(),
    expiresAt,
    cancelledAt: toDate(rx.cancelledAt)?.getTime() ?? null,
    doctorName: rx.doctorName,
    doctorDepartment: rx.doctorDepartment,
    doctorMdcNumber: rx.doctorMdcNumber,
    items: rx.items,
  };
});

/* ------------------------------------------------------------------ */
/* deleteExpiredPrescriptions                                          */
/* ------------------------------------------------------------------ */

const DELETE_PAGE = 150; // 3 writes each, inside a 500-write batch

/** Deletes prescriptions past their 7 days; an audit line stays. Resolves how many. */
async function deleteExpired(now = Date.now()) {
  let deleted = 0;
  for (;;) {
    const page = await db
      .collection("prescriptions")
      .where("expiresAt", "<=", Timestamp.fromMillis(now))
      .limit(DELETE_PAGE)
      .get();
    if (page.empty) break;
    const batch = db.batch();
    for (const doc of page.docs) {
      const rx = doc.data();
      batch.delete(doc.ref);
      batch.delete(rxSignatureRef(doc.id));
      audit(batch, {
        action: "Deleted a prescription after 7 days",
        code: "prescription.deleted",
        category: "consultation",
        targetType: "prescription",
        targetId: doc.id,
        patientUid: rx.patientUid,
        details: {
          consultationId: rx.consultationId,
          doctorUid: rx.doctorUid,
          status: rx.status,
          issuedAt: toDate(rx.issuedAt)?.toISOString() ?? null,
        },
      });
    }
    await batch.commit();
    deleted += page.size;
    if (page.size < DELETE_PAGE) break;
  }
  if (deleted) logger.info("Expired prescriptions deleted", { deleted });
  return deleted;
}

exports.deleteExpiredPrescriptions = task("deleteExpiredPrescriptions", "every 60 minutes", () => deleteExpired());
exports.deleteExpired = deleteExpired;
