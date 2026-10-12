// The admin metrics report (lib/metrics.js buildReport).
// Run: cd functions && npm test

const test = require("node:test");
const assert = require("node:assert/strict");
const { Timestamp } = require("firebase-admin/firestore");
const { buildReport, bucketsBetween } = require("../../lib/metrics");

const day = (y, m, d, h = 10) => Date.UTC(y, m - 1, d, h);
const ts = (t) => Timestamp.fromMillis(t);
const OCT = { fromMs: Date.UTC(2026, 9, 1), toMs: Date.UTC(2026, 10, 1) };
const table = (r, title) => r.tables.find((t) => t.title === title);
const value = (r, title, label) => {
  const row = table(r, title).rows.find((x) => x[0] === label);
  assert.ok(row, `row "${label}" in ${title}`);
  return row[1].v;
};

test("periods: a month is day by day, a quarter or year month by month", () => {
  assert.equal(bucketsBetween(OCT.fromMs, OCT.toMs, "day").length, 31);
  const q = bucketsBetween(Date.UTC(2026, 9, 1), Date.UTC(2027, 0, 1), "month");
  assert.deepEqual(q.map((b) => b.label), ["Oct 2026", "Nov 2026", "Dec 2026"]);
  assert.equal(buildReport(OCT).groupBy, "day");
  assert.equal(buildReport({ fromMs: Date.UTC(2026, 0, 1), toMs: Date.UTC(2027, 0, 1) }).groupBy, "month");
  assert.equal(bucketsBetween(Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1), "month").length, 12);
});

test("revenue: gross, Paystack charges, refunds and net", () => {
  const r = buildReport({
    ...OCT,
    payments: [
      { amount: 150, fees: 2.93, type: "OPD", paidAt: ts(day(2026, 10, 2)) },
      { amount: 150, fees: 2.93, type: "SURGICAL", paidAt: ts(day(2026, 10, 2)) },
      { amount: 50, fees: 0.98, type: "NO_SHOW_FEE", paidAt: ts(day(2026, 10, 5)) },
    ],
    refunds: [
      { amountRefunded: 120, refundedAt: ts(day(2026, 10, 6)), source: "refundRequests" },
      { amount: 150, refundedAt: ts(day(2026, 10, 7)), source: "paymentIssues" },
    ],
  });
  assert.equal(value(r, "Revenue", "Gross received"), 350);
  assert.equal(value(r, "Revenue", "Paystack charges"), 6.84);
  assert.equal(value(r, "Revenue", "Net received (after charges)"), 343.16);
  assert.equal(value(r, "Revenue", "Amount refunded"), 270);
  assert.equal(value(r, "Revenue", "Of which automatic (unusable payments)"), 1);
  assert.equal(value(r, "Revenue", "Net after charges and refunds"), 73.16);
  assert.equal(value(r, "Revenue", "No-show fees (1 payments)"), 50);

  // The day-by-day table adds up to the same totals.
  const rows = table(r, "Day by day").rows;
  const sum = (i) => Math.round(rows.reduce((s, x) => s + x[i], 0) * 100) / 100;
  assert.equal(sum(5), 350);
  assert.equal(sum(7), 270);
  assert.equal(sum(8), 73.16);
  assert.equal(rows[1][0], "2 Oct 2026");
  assert.equal(rows[1][5], 300);
});

test("quality: completion, no-show and connection rates, start delay", () => {
  const h = (outcome, extra = {}) => ({
    doctorUid: "d1",
    doctorName: "Dr Mensah",
    type: "OPD",
    mode: "online",
    outcome,
    scheduledTime: ts(day(2026, 10, 3)),
    ...extra,
  });
  const r = buildReport({
    ...OCT,
    history: [
      h("completed", { met: true, startedAt: ts(day(2026, 10, 3) + 4 * 60000) }),
      h("completed", { met: true, startedAt: ts(day(2026, 10, 3) - 10 * 60000) }), // early counts as 0
      h("completed", { met: true, startedAt: ts(day(2026, 10, 3) + 2 * 60000) }),
      h("no_show", { met: false }),
      h("completed", { mode: "in_person", doctorUid: "d2", doctorName: "Dr Owusu" }),
    ],
    events: { "consultation.doctor_unavailable": 2, "payment.refund_requested": 1 },
  });
  assert.equal(value(r, "Quality of service", "Completed, share of closed consultations"), 80);
  assert.equal(value(r, "Quality of service", "Patient no-show rate"), 20);
  assert.equal(value(r, "Quality of service", "Video calls where doctor and patient connected"), 75);
  assert.equal(value(r, "Quality of service", "Median minutes late a video call began"), 2);
  assert.equal(value(r, "Quality of service", "Doctor couldn't make it / didn't join in time"), 2);

  const doctors = table(r, "By doctor").rows;
  assert.deepEqual(doctors[0], ["Dr Mensah", 4, 3, 1, 4, 75]);
  assert.deepEqual(doctors[1], ["Dr Owusu", 1, 1, 0, 0, null]);
});

test("empty period: no division by zero, rates left blank", () => {
  const r = buildReport(OCT);
  assert.equal(value(r, "Quality of service", "Patient no-show rate"), null);
  assert.equal(value(r, "Revenue", "Gross received"), 0);
  assert.equal(value(r, "System", "Emails sent (only the last 30 days are kept)"), null);
});

test("the report carries no patient details", () => {
  const r = buildReport({
    ...OCT,
    history: [{ doctorName: "Dr A", outcome: "completed", mode: "online", type: "OPD", patientUid: "p1", consultationId: "HFC-SECRET", scheduledTime: ts(day(2026, 10, 3)) }],
  });
  const text = JSON.stringify(r);
  assert.ok(!text.includes("p1") && !text.includes("HFC-SECRET"));
});
