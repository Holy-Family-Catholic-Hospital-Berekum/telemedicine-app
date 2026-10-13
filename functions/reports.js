// Admin metrics reports (Metrics & reports tab → "Export a report").
//
// Two-admin rule for downloads (hospital decision, 13 Oct 2026): one admin
// prepares and views a report; a DIFFERENT admin must approve before the
// file can be downloaded.
//
//   exportMetrics({ from, to, label? })   prepares the report for those days
//       (both included, hospital time = UTC; lib/metrics.js buildReport),
//       returns it for viewing, and opens reportRequests/{id} (pending,
//       REQUEST_HOURS). The report itself is kept in reportData/{id}, which no
//       browser can read, so approval can't be bypassed by reading the
//       database. Preparing a new report replaces the admin's open one.
//   cancelReportRequest({ requestId })    the admin who prepared it cancels
//   decideReportRequest({ requestId, decision: "approve" | "reject" })
//       another admin decides
//   downloadReport({ requestId })         the admin who prepared it, once
//       approved, within APPROVAL_HOURS: returns the stored report (the page
//       makes the CSV / PDF), once; the stored data is then deleted.
// Every step is audited (metrics.report_*). Viewing before approval can't
// stop someone copying their own screen; the approval governs the file.
//
// Cost: reads only the period's payments, refunds, booking log, closed
// consultations and (last 30 days only) the email outbox, with just the
// fields used; audit-log events are counted by Firestore aggregation
// (index auditLog code + timestamp), not downloaded. A year at a busy
// hospital is a few thousand reads, well inside the free daily quota.
// Contains no patient names, contact details or consultation IDs.

const {
  onCall,
  db,
  Timestamp,
  HttpsError,
  requireRole,
  rateLimit,
  audit,
  requestMeta,
  str,
  docId,
  serverTime,
} = require("./lib/core");
const { task } = require("./lib/task");
const { buildReport, DAY_MS } = require("./lib/metrics");

const MAX_DAYS = 366;
const REQUEST_HOURS = 72;
const APPROVAL_HOURS = 24;
const requestRef = (id) => db.collection("reportRequests").doc(id);
const dataRef = (id) => db.collection("reportData").doc(id);
const EVENT_CODES = [
  "consultation.doctor_unavailable",
  "consultation.call_incomplete",
  "booking.rescheduled",
  "booking.reschedule_requested",
  "payment.refund_requested",
  "payment.flagged",
  "payment.reconciled",
  "email.failed",
  "recording.failed",
  "recording.missing",
  "consultation.capture_attempt",
  "webhook.signature_invalid",
  "staff.mfa_failed",
];
// The mail outbox keeps 30 days (lib/mailQueue.js); older periods show the
// email.failed audit count instead.
const MAIL_KEPT_DAYS = 30;

function parseDay(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpsError("invalid-argument", `Choose the ${name} date.`);
  }
  const t = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== value) {
    throw new HttpsError("invalid-argument", `The ${name} date isn't a real date.`);
  }
  return t;
}

const inRange = (col, field, fromMs, toMs) =>
  db
    .collection(col)
    .where(field, ">=", Timestamp.fromMillis(fromMs))
    .where(field, "<", Timestamp.fromMillis(toMs));

const rows = (snap) => snap.docs.map((d) => d.data());

exports.exportMetrics = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  await rateLimit(caller.uid, "exportMetrics", { max: 30, windowSeconds: 3600 });
  const d = request.data || {};
  const fromMs = parseDay(d.from, "start");
  const toMs = parseDay(d.to, "end") + DAY_MS; // the end day is included
  if (toMs <= fromMs) throw new HttpsError("invalid-argument", "The end date is before the start date.");
  if ((toMs - fromMs) / DAY_MS > MAX_DAYS) {
    throw new HttpsError("invalid-argument", "A report can cover at most one year. Export longer spans year by year.");
  }
  const label = str(d.label, { field: "Report name", max: 60, optional: true }) || `${d.from} to ${d.to}`;

  const mailFrom = Date.now() - MAIL_KEPT_DAYS * DAY_MS;
  const mailCovered = fromMs >= mailFrom;

  const [payments, refundReqs, issues, bookings, history, mail, ...counts] = await Promise.all([
    inRange("confirmedPayments", "paidAt", fromMs, toMs).select("amount", "fees", "type", "mode", "paidAt").get(),
    inRange("refundRequests", "refundedAt", fromMs, toMs).select("status", "amountRefunded", "refundedAt").get(),
    inRange("paymentIssues", "refundedAt", fromMs, toMs).select("status", "amountRefunded", "amount", "refundedAt").get(),
    inRange("bookingLog", "confirmedAt", fromMs, toMs).select("type", "mode", "payAtHospital", "confirmedAt").get(),
    inRange("consultationHistory", "scheduledTime", fromMs, toMs)
      .select("doctorUid", "doctorName", "type", "mode", "outcome", "scheduledTime", "startedAt", "met", "doctorUnavailable")
      .get(),
    mailCovered ? inRange("mail", "createdAt", fromMs, toMs).select("status").get() : null,
    ...EVENT_CODES.map((code) =>
      inRange("auditLog", "timestamp", fromMs, toMs).where("code", "==", code).count().get(),
    ),
  ]);

  const refunded = (snap, source) =>
    rows(snap)
      .filter((r) => r.status === "refunded")
      .map((r) => ({ ...r, source }));
  const events = Object.fromEntries(EVENT_CODES.map((code, i) => [code, counts[i].data().count]));

  const report = buildReport({
    fromMs,
    toMs,
    payments: rows(payments),
    refunds: [...refunded(refundReqs, "refundRequests"), ...refunded(issues, "paymentIssues")],
    bookings: rows(bookings),
    history: rows(history),
    events,
    mail: mail ? rows(mail) : null,
  });

  const generatedAt = new Date().toISOString();
  const full = { label, from: d.from, to: d.to, generatedAt, ...report };

  // A new report replaces this admin's open one (pending or approved).
  const mine = await db
    .collection("reportRequests")
    .where("requestedByUid", "==", caller.uid)
    .where("status", "in", ["pending", "approved"])
    .get();
  const ref = db.collection("reportRequests").doc();
  const batch = db.batch();
  for (const old of mine.docs) {
    batch.update(old.ref, { status: "replaced", closedAt: serverTime() });
    batch.delete(dataRef(old.id));
  }
  batch.set(ref, {
    status: "pending",
    label,
    from: d.from,
    to: d.to,
    requestedByUid: caller.uid,
    requestedByName: caller.profile.name || null,
    createdAt: serverTime(),
    expiresAt: Timestamp.fromMillis(Date.now() + REQUEST_HOURS * 3600 * 1000),
  });
  // Firestore can't store nested arrays: the tables are kept as JSON.
  batch.set(dataRef(ref.id), { report: JSON.stringify(full), createdAt: serverTime() });
  audit(batch, {
    actorId: caller.uid,
    actorRole: "admin",
    action: `Prepared the metrics report (${label}); download needs a second admin`,
    code: "metrics.report_prepared",
    category: "admin",
    targetType: "report",
    targetId: ref.id,
    details: { from: d.from, to: d.to },
    meta: requestMeta(request),
  });
  await batch.commit();

  return { requestId: ref.id, ...full };
});

/** The admin who prepared a report cancels it. data: { requestId } */
exports.cancelReportRequest = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const requestId = docId(request.data?.requestId, "Report");
  await rateLimit(caller.uid, "cancelReportRequest", { max: 60, windowSeconds: 3600 });
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(requestRef(requestId));
    if (!snap.exists) throw new HttpsError("not-found", "Report not found.");
    const r = snap.data();
    if (r.requestedByUid !== caller.uid) {
      throw new HttpsError("permission-denied", "Only the admin who prepared this report can cancel it.");
    }
    if (!["pending", "approved"].includes(r.status)) {
      throw new HttpsError("failed-precondition", "This report is already closed.");
    }
    tx.update(requestRef(requestId), { status: "cancelled", closedAt: serverTime() });
    tx.delete(dataRef(requestId));
    audit(tx, {
      actorId: caller.uid,
      actorRole: "admin",
      action: `Cancelled the metrics report (${r.label})`,
      code: "metrics.report_cancelled",
      category: "admin",
      targetType: "report",
      targetId: requestId,
      meta: requestMeta(request),
    });
  });
  return { status: "cancelled" };
});

/** Another admin approves or rejects the download. data: { requestId, decision } */
exports.decideReportRequest = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const d = request.data || {};
  const requestId = docId(d.requestId, "Report");
  const approve = d.decision === "approve";
  await rateLimit(caller.uid, "decideReportRequest", { max: 60, windowSeconds: 3600 });
  const status = await db.runTransaction(async (tx) => {
    const snap = await tx.get(requestRef(requestId));
    if (!snap.exists) throw new HttpsError("not-found", "Report not found.");
    const r = snap.data();
    if (r.status !== "pending") throw new HttpsError("failed-precondition", "This report has already been handled.");
    if (r.requestedByUid === caller.uid) {
      throw new HttpsError("permission-denied", "Another admin must approve or reject a report you prepared.");
    }
    if ((r.expiresAt?.toMillis?.() ?? 0) < Date.now()) {
      tx.update(requestRef(requestId), { status: "expired", closedAt: serverTime() });
      tx.delete(dataRef(requestId));
      return "expired";
    }
    tx.update(requestRef(requestId), {
      status: approve ? "approved" : "rejected",
      decidedByUid: caller.uid,
      decidedByName: caller.profile.name || null,
      decidedAt: serverTime(),
      ...(approve
        ? { usableUntil: Timestamp.fromMillis(Date.now() + APPROVAL_HOURS * 3600 * 1000) }
        : { closedAt: serverTime() }),
    });
    if (!approve) tx.delete(dataRef(requestId));
    audit(tx, {
      actorId: caller.uid,
      actorRole: "admin",
      action: approve
        ? `Approved downloading the metrics report (${r.label})`
        : `Rejected downloading the metrics report (${r.label})`,
      code: approve ? "metrics.report_approved" : "metrics.report_rejected",
      category: "admin",
      targetType: "report",
      targetId: requestId,
      details: { requestedByUid: r.requestedByUid },
      meta: requestMeta(request),
    });
    return approve ? "approved" : "rejected";
  });
  if (status === "expired") {
    throw new HttpsError("failed-precondition", "This request expired. The admin can prepare the report again.");
  }
  return { status };
});

/** The admin who prepared an approved report fetches it, once. data: { requestId } */
exports.downloadReport = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const requestId = docId(request.data?.requestId, "Report");
  await rateLimit(caller.uid, "downloadReport", { max: 30, windowSeconds: 3600 });
  const report = await db.runTransaction(async (tx) => {
    const [snap, data] = await Promise.all([tx.get(requestRef(requestId)), tx.get(dataRef(requestId))]);
    if (!snap.exists) throw new HttpsError("not-found", "Report not found.");
    const r = snap.data();
    if (r.requestedByUid !== caller.uid) {
      throw new HttpsError("permission-denied", "Only the admin who prepared this report can download it.");
    }
    if (r.status !== "approved") {
      throw new HttpsError(
        "failed-precondition",
        r.status === "pending" ? "Another admin hasn't approved this download yet." : "This report is closed.",
      );
    }
    if ((r.usableUntil?.toMillis?.() ?? 0) < Date.now() || !data.exists) {
      tx.update(requestRef(requestId), { status: "expired", closedAt: serverTime() });
      tx.delete(dataRef(requestId));
      return null;
    }
    tx.update(requestRef(requestId), { status: "downloaded", downloadedAt: serverTime(), closedAt: serverTime() });
    tx.delete(dataRef(requestId));
    audit(tx, {
      actorId: caller.uid,
      actorRole: "admin",
      action: `Downloaded the metrics report (${r.label})`,
      code: "metrics.report_downloaded",
      category: "admin",
      targetType: "report",
      targetId: requestId,
      meta: requestMeta(request),
    });
    return JSON.parse(data.data().report);
  });
  if (!report) throw new HttpsError("failed-precondition", "The approval has expired. Prepare the report again.");
  return report;
});

// Daily: report data nobody downloaded (expired or forgotten) is deleted
// after REQUEST_HOURS + APPROVAL_HOURS; the request records stay as history.
exports.cleanupReportData = task("cleanupReportData", { schedule: "every 24 hours", timeoutSeconds: 120 }, async () => {
  const cutoff = Timestamp.fromMillis(Date.now() - (REQUEST_HOURS + APPROVAL_HOURS) * 3600 * 1000);
  const old = await db.collection("reportData").where("createdAt", "<", cutoff).limit(200).get();
  const batch = db.batch();
  for (const doc of old.docs) {
    batch.delete(doc.ref);
    batch.set(requestRef(doc.id), { status: "expired", closedAt: serverTime() }, { merge: true });
  }
  if (!old.empty) await batch.commit();
});
