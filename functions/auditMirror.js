// functions/auditMirror.js
//
//   mirrorAuditLog  Firestore trigger: copies every new auditLog entry to
//                   Cloud Logging as one structured "AUDIT" line
//
// Why: the auditLog collection is written only by Cloud Functions, but
// anyone with Owner/Editor on the Google Cloud project could still edit or
// delete it in the console. A log sink routes these lines into the
// "audit-locked" log bucket, whose retention is LOCKED (1 year): nobody,
// including project owners, can delete or shorten it. Log-based alerts on
// the same lines email the security contact (SECURITY_SETUP.md, "Audit
// copy and alerts").
//
// Entries hold IDs, codes, the acting account and IP, never clinical
// content (lib/core.js audit()).

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
require("./lib/core"); // region and app

exports.mirrorAuditLog = onDocumentCreated({ document: "auditLog/{entryId}", retry: true }, async (event) => {
  const data = event.data?.data();
  if (!data) return;
  logger.info("AUDIT", {
    auditId: event.params.entryId,
    code: data.code || null,
    category: data.category || null,
    result: data.result || null,
    action: data.action || null,
    actorId: data.actorId || null,
    actorRole: data.actorRole || null,
    targetType: data.targetType || null,
    targetId: data.targetId || null,
    patientUid: data.patientUid || null,
    reason: data.reason || null,
    details: data.details || null,
    ip: data.ip || null,
    at: data.timestamp?.toDate?.().toISOString() || event.time,
  });
});
