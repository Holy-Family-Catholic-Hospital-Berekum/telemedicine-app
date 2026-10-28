// Report periods and the CSV / on-screen formats (components/admin/reportFormat.js).
import { test } from "node:test";
import assert from "node:assert/strict";

import { MONTHS, cellOf, csvCell, fileName, periodOf, shortDate, show, toCsv } from "../reportFormat.js";
import { formatDateTime } from "../../../src/constants.js";

test("periodOf: month, quarter, year and custom dates", () => {
  assert.deepEqual(periodOf("month", { year: 2026, month: 10 }), {
    from: "2026-10-01",
    to: "2026-10-31",
    label: "October 2026",
  });
  assert.equal(periodOf("month", { year: 2028, month: 2 }).to, "2028-02-29"); // leap year
  assert.equal(periodOf("month", { year: 2027, month: 2 }).to, "2027-02-28");
  assert.deepEqual(periodOf("quarter", { year: 2026, quarter: 4 }), {
    from: "2026-10-01",
    to: "2026-12-31",
    label: "Q4 2026 (Oct–Dec)",
  });
  assert.deepEqual(periodOf("year", { year: 2027 }), { from: "2027-01-01", to: "2027-12-31", label: "2027" });
  assert.deepEqual(periodOf("custom", { from: "2026-10-05", to: "2026-11-02" }), {
    from: "2026-10-05",
    to: "2026-11-02",
    label: "5 Oct 2026 – 2 Nov 2026",
  });
  assert.equal(periodOf("custom", { from: "2026-10-05", to: "" }), null);
});

test("shortDate and MONTHS", () => {
  assert.equal(shortDate("2026-01-09"), "9 Jan 2026");
  assert.equal(MONTHS.length, 12);
});

test("show: how a value appears on screen and in the PDF", () => {
  assert.equal(show(1234.5, "money"), "GHS 1,234.50");
  assert.equal(show(12, "percent"), "12%");
  assert.equal(show(7, "minutes"), "7 min");
  assert.equal(show(1234.567), "1,234.57");
  assert.equal(show("General OPD"), "General OPD");
  assert.equal(show(null), "—");
  assert.equal(show(undefined, "money"), "—");
  assert.equal(show(""), "—");
  assert.equal(show(0, "money"), "GHS 0.00");
});

test("csvCell: numbers stay numbers, text is quoted when needed", () => {
  assert.equal(csvCell(150), "150");
  assert.equal(csvCell(-5), "-5");
  assert.equal(csvCell("General OPD"), "General OPD");
  assert.equal(csvCell("a, b"), '"a, b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("two\nlines"), '"two\nlines"');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("csvCell: text that Excel could run as a formula is neutralised", () => {
  assert.equal(csvCell("=SUM(A1:A9)"), "'=SUM(A1:A9)");
  assert.equal(csvCell("+233241234567"), "'+233241234567");
  assert.equal(csvCell("-2"), "'-2");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell("\tx"), "'\tx");
  assert.equal(csvCell('=HYPERLINK("x","y")'), `"'=HYPERLINK(""x"",""y"")"`);
});

test("cellOf: a summary cell carries its own format", () => {
  assert.deepEqual(cellOf({ v: 10, f: "percent" }, { f: "money" }), { v: 10, f: "percent" });
  assert.deepEqual(cellOf(50, { f: "money" }), { v: 50, f: "money" });
  assert.deepEqual(cellOf(null, { f: "money" }), { v: null, f: "money" });
  assert.deepEqual(cellOf("x", undefined), { v: "x", f: undefined });
});

test("toCsv: the whole file", () => {
  const report = {
    label: "October 2026",
    from: "2026-10-01",
    to: "2026-10-31",
    generatedAt: "2026-11-01T08:00:00Z",
    tables: [
      {
        title: "Revenue",
        columns: [{ label: "Type" }, { label: "Amount", f: "money" }, { label: "Share", f: "percent" }],
        rows: [
          ["General OPD", 150.456, 60],
          ["=bad", null, { v: 40, f: "percent" }],
        ],
      },
      { title: "Empty", columns: [{ label: "A" }], rows: [] },
    ],
  };
  const csv = toCsv(report);
  assert.ok(csv.startsWith("﻿"), "starts with the byte-order mark");
  assert.ok(csv.endsWith("\r\n"));
  const lines = csv.slice(1).split("\r\n");
  assert.deepEqual(lines, [
    '"Holy Family Catholic Hospital, Berekum: telemedicine report"',
    "Period,October 2026",
    "From,2026-10-01,To,2026-10-31",
    `Prepared,${csvCell(formatDateTime(new Date(report.generatedAt)))}`,
    "",
    "Revenue",
    "Type,Amount,Share",
    "General OPD,150.46,60%",
    "'=bad,,40%",
    "",
    "Empty",
    "A",
    "",
    "",
  ]);
});

test("fileName", () => {
  assert.equal(
    fileName({ from: "2026-10-01", to: "2026-10-31" }, "csv"),
    "telemedicine-report-2026-10-01-to-2026-10-31.csv",
  );
});
