// Admin metrics export (Metrics & reports tab → "Export a report").
//
// exportMetrics({ from: "YYYY-MM-DD", to: "YYYY-MM-DD", label? }) returns
// the report for those days (both included, hospital time = UTC) as tables
// (lib/metrics.js buildReport); the admin page saves them as CSV or prints
// them as a PDF. Admins only; each export is audited (metrics.exported).
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
} = require("./lib/core");
const { buildReport, DAY_MS } = require("./lib/metrics");

const MAX_DAYS = 366;
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

  await audit(null, {
    actorId: caller.uid,
    actorRole: "admin",
    action: `Exported the metrics report (${label})`,
    code: "metrics.exported",
    category: "admin",
    details: { from: d.from, to: d.to },
    meta: requestMeta(request),
  });

  return {
    label,
    from: d.from,
    to: d.to,
    generatedAt: new Date().toISOString(),
    ...report,
  };
});
