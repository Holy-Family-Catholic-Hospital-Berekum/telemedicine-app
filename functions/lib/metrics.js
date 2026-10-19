// Builds the admin metrics report (reports.js exportMetrics) from records
// already read for the period. Pure functions: no database, so the sums are
// covered by functions/test/unit/metrics.test.js.
//
// The report is a list of tables ({ title, columns, rows }) that the admin
// page turns into CSV or a printable PDF without knowing what's in them.
// Values carry a format so both show them the same way:
//   "count" | "number" | "money" (GHS) | "percent" (0-100) | "minutes" | "text"
// A summary cell is { v, f }; a breakdown column carries f for its cells.
//
// Hospital time is Africa/Accra = UTC, so periods are cut on UTC days.

const { round2 } = require("./money");

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TYPE_NAME = {
  OPD: "General OPD",
  SURGICAL: "Surgical",
  NO_SHOW_FEE: "No-show fees",
  RESCHEDULE_FEE: "Late reschedule fees",
};
const MODE_NAME = { online: "Video call", in_person: "At the hospital" };

const ms = (v) => {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return null;
};
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pct = (part, whole) => (whole > 0 ? round2((part / whole) * 100) : null);

/** Group by day for up to about two months, otherwise by month. */
function groupByFor(fromMs, toMs) {
  return toMs - fromMs <= 62 * DAY_MS ? "day" : "month";
}

function bucketOf(t, groupBy) {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (groupBy === "month") return { key: `${y}-${String(m + 1).padStart(2, "0")}`, label: `${MONTHS[m]} ${y}` };
  const day = d.getUTCDate();
  return { key: `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`, label: `${day} ${MONTHS[m]} ${y}` };
}

/** Every bucket in [fromMs, toMs), in order, so empty days/months still show. */
function bucketsBetween(fromMs, toMs, groupBy) {
  const out = [];
  const seen = new Set();
  const d = new Date(fromMs);
  while (d.getTime() < toMs) {
    const b = bucketOf(d.getTime(), groupBy);
    if (!seen.has(b.key)) {
      seen.add(b.key);
      out.push(b);
    }
    if (groupBy === "month") d.setUTCMonth(d.getUTCMonth() + 1, 1);
    else d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function median(list) {
  if (list.length === 0) return null;
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : round2((s[mid - 1] + s[mid]) / 2);
}

/**
 * input:
 *   fromMs, toMs        the period [from, to)
 *   payments            confirmedPayments: { amount, fees, type, mode, paidAt }
 *   refunds             refundRequests + paymentIssues refunded in the period:
 *                       { amountRefunded | amount, refundedAt, source }
 *   bookings            bookingLog: { type, mode, payAtHospital, confirmedAt }
 *   history             consultationHistory with scheduledTime in the period
 *   events              { [auditCode]: count } for the period
 *   mail                mail outbox (only the last 30 days are kept):
 *                       { status }, or null when the period is older
 */
function buildReport({ fromMs, toMs, payments = [], refunds = [], bookings = [], history = [], events = {}, mail = null }) {
  const groupBy = groupByFor(fromMs, toMs);
  const buckets = bucketsBetween(fromMs, toMs, groupBy);
  const rowOf = new Map(
    buckets.map((b) => [
      b.key,
      { label: b.label, bookings: 0, consultations: 0, completed: 0, noShows: 0, gross: 0, charges: 0, refunded: 0 },
    ]),
  );
  const at = (t) => (t == null ? null : rowOf.get(bucketOf(t, groupBy).key) || null);

  // ---- money ----
  let gross = 0;
  let charges = 0;
  const byType = {};
  for (const p of payments) {
    const amount = num(p.amount);
    const fee = num(p.fees);
    gross += amount;
    charges += fee;
    const t = (byType[p.type || "OTHER"] ||= { count: 0, amount: 0 });
    t.count += 1;
    t.amount += amount;
    const r = at(ms(p.paidAt));
    if (r) {
      r.gross += amount;
      r.charges += fee;
    }
  }
  let refunded = 0;
  let refundCount = 0;
  let autoRefunds = 0;
  for (const x of refunds) {
    const amount = num(x.amountRefunded ?? x.amount);
    refunded += amount;
    refundCount += 1;
    if (x.source === "paymentIssues") autoRefunds += 1;
    const r = at(ms(x.refundedAt));
    if (r) r.refunded += amount;
  }

  // ---- bookings ----
  const bookingsByMode = { online: 0, in_person: 0 };
  let payAtHospital = 0;
  for (const b of bookings) {
    if (b.mode in bookingsByMode) bookingsByMode[b.mode] += 1;
    if (b.payAtHospital) payAtHospital += 1;
    const r = at(ms(b.confirmedAt));
    if (r) r.bookings += 1;
  }

  // ---- consultations (closed, by appointment date) ----
  const outcomes = { completed: 0, no_show: 0, cancelled: 0 };
  const byTypeMode = {};
  const doctors = new Map();
  let online = 0;
  let onlineMet = 0;
  const startDelays = [];
  for (const h of history) {
    const outcome = h.outcome in outcomes ? h.outcome : null;
    if (outcome) outcomes[outcome] += 1;
    const key = `${TYPE_NAME[h.type] || h.type || "Other"} · ${MODE_NAME[h.mode] || h.mode || "Other"}`;
    const tm = (byTypeMode[key] ||= { total: 0, completed: 0, noShows: 0 });
    tm.total += 1;
    if (outcome === "completed") tm.completed += 1;
    if (outcome === "no_show") tm.noShows += 1;

    const doc = doctors.get(h.doctorUid || "?") || {
      name: h.doctorName || "Unknown doctor",
      total: 0,
      completed: 0,
      noShows: 0,
      video: 0,
      videoMet: 0,
    };
    doc.total += 1;
    if (outcome === "completed") doc.completed += 1;
    if (outcome === "no_show") doc.noShows += 1;

    if (h.mode === "online") {
      online += 1;
      doc.video += 1;
      if (h.met) {
        onlineMet += 1;
        doc.videoMet += 1;
        const start = ms(h.scheduledTime);
        const began = ms(h.startedAt);
        if (start != null && began != null) startDelays.push(Math.max(0, Math.round((began - start) / 60000)));
      }
    }
    doctors.set(h.doctorUid || "?", doc);

    const r = at(ms(h.scheduledTime));
    if (r) {
      r.consultations += 1;
      if (outcome === "completed") r.completed += 1;
      if (outcome === "no_show") r.noShows += 1;
    }
  }
  const closed = history.length;
  const paidBookings = (byType.OPD?.count || 0) + (byType.SURGICAL?.count || 0);
  const ev = (code) => num(events[code]);

  // ---- tables ----
  const revenue = {
    title: "Revenue",
    columns: [{ label: "Measure" }, { label: "Value" }],
    rows: [
      ["Payments received", { v: payments.length, f: "count" }],
      ["Gross received", { v: round2(gross), f: "money" }],
      ["Paystack charges", { v: round2(charges), f: "money" }],
      ["Net received (after charges)", { v: round2(gross - charges), f: "money" }],
      ...["OPD", "SURGICAL", "NO_SHOW_FEE", "RESCHEDULE_FEE"].map((t) => [
        `${TYPE_NAME[t]} (${byType[t]?.count || 0} payments)`,
        { v: round2(byType[t]?.amount || 0), f: "money" },
      ]),
      ["Refunds paid out", { v: refundCount, f: "count" }],
      ["Amount refunded", { v: round2(refunded), f: "money" }],
      ["Of which automatic (unusable payments)", { v: autoRefunds, f: "count" }],
      ["Net after charges and refunds", { v: round2(gross - charges - refunded), f: "money" }],
    ],
  };

  const activity = {
    title: "Bookings and consultations",
    columns: [{ label: "Measure" }, { label: "Value" }],
    rows: [
      ["Bookings confirmed", { v: bookings.length, f: "count" }],
      ["Video call bookings", { v: bookingsByMode.online, f: "count" }],
      ["Hospital visit bookings", { v: bookingsByMode.in_person, f: "count" }],
      ["Hospital visits booked to pay at the hospital", { v: payAtHospital, f: "count" }],
      ["Consultations closed (by appointment date)", { v: closed, f: "count" }],
      ["Completed", { v: outcomes.completed, f: "count" }],
      ["Patient no-shows", { v: outcomes.no_show, f: "count" }],
      ["Cancelled and refunded (doctor couldn't make it)", { v: outcomes.cancelled, f: "count" }],
      ...Object.entries(byTypeMode)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, t]) => [`${k}: closed / completed / no-shows`, { v: `${t.total} / ${t.completed} / ${t.noShows}`, f: "text" }]),
    ],
  };

  const quality = {
    title: "Quality of service",
    columns: [{ label: "Measure" }, { label: "Value" }],
    rows: [
      ["Completed, share of closed consultations", { v: pct(outcomes.completed, closed), f: "percent" }],
      ["Patient no-show rate", { v: pct(outcomes.no_show, closed), f: "percent" }],
      ["Video calls where doctor and patient connected", { v: pct(onlineMet, online), f: "percent" }],
      ["Median minutes late a video call began", { v: median(startDelays), f: "minutes" }],
      ["Doctor couldn't make it / didn't join in time", { v: ev("consultation.doctor_unavailable"), f: "count" }],
      ["Video calls that couldn't be completed", { v: ev("consultation.call_incomplete"), f: "count" }],
      ["Appointments given a new time", { v: ev("booking.rescheduled"), f: "count" }],
      ["Reschedule requests from patients", { v: ev("booking.reschedule_requested"), f: "count" }],
      ["Refund requests", { v: ev("payment.refund_requested"), f: "count" }],
      ["Refund requests per 100 paid bookings", { v: pct(ev("payment.refund_requested"), paidBookings), f: "number" }],
    ],
  };

  const mailCount = (s) => (mail ? mail.filter((m) => m.status === s).length : null);
  const system = {
    title: "System",
    columns: [{ label: "Measure" }, { label: "Value" }],
    rows: [
      [
        mail ? "Emails sent" : "Emails sent (only the last 30 days are kept)",
        { v: mailCount("sent"), f: mail ? "count" : "text" },
      ],
      ["Emails that failed", { v: mail ? mailCount("failed") : ev("email.failed"), f: "count" }],
      ["Emails dropped (too late to be useful)", { v: mailCount("skipped"), f: mail ? "count" : "text" }],
      ["Payments flagged for automatic refund", { v: ev("payment.flagged"), f: "count" }],
      ["Payments found by the nightly check", { v: ev("payment.reconciled"), f: "count" }],
      ["Call recordings that failed or went missing", { v: ev("recording.failed") + ev("recording.missing"), f: "count" }],
      ["Screen capture attempts seen on calls", { v: ev("consultation.capture_attempt"), f: "count" }],
      ["Rejected payment messages (bad signature)", { v: ev("webhook.signature_invalid"), f: "count" }],
      ["Failed staff authenticator codes", { v: ev("staff.mfa_failed"), f: "count" }],
    ],
  };

  const breakdown = {
    title: groupBy === "month" ? "Month by month" : "Day by day",
    columns: [
      { label: groupBy === "month" ? "Month" : "Day" },
      { label: "Bookings", f: "count" },
      { label: "Consultations closed", f: "count" },
      { label: "Completed", f: "count" },
      { label: "No-shows", f: "count" },
      { label: "Gross (GHS)", f: "money" },
      { label: "Paystack charges (GHS)", f: "money" },
      { label: "Refunded (GHS)", f: "money" },
      { label: "Net (GHS)", f: "money" },
    ],
    rows: [...rowOf.values()].map((r) => [
      r.label,
      r.bookings,
      r.consultations,
      r.completed,
      r.noShows,
      round2(r.gross),
      round2(r.charges),
      round2(r.refunded),
      round2(r.gross - r.charges - r.refunded),
    ]),
  };

  const byDoctor = {
    title: "By doctor",
    columns: [
      { label: "Doctor" },
      { label: "Consultations closed", f: "count" },
      { label: "Completed", f: "count" },
      { label: "Patient no-shows", f: "count" },
      { label: "Video calls", f: "count" },
      { label: "Video calls connected", f: "percent" },
    ],
    rows: [...doctors.values()]
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
      .map((d) => [d.name, d.total, d.completed, d.noShows, d.video, pct(d.videoMet, d.video)]),
  };

  return { groupBy, tables: [revenue, activity, quality, system, breakdown, byDoctor] };
}

module.exports = { buildReport, bucketsBetween, groupByFor, DAY_MS };
