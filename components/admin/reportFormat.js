// Report periods and file formats for "Export a report" (metricsExport.jsx).
import { formatDateTime } from "../../src/constants.js";

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
// Byte-order mark: tells Excel the file is UTF-8.
const BOM = "﻿";
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const shortDate = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
};

/** { from, to, label } for the chosen period, or null if incomplete. */
export function periodOf(kind, { year, month, quarter, from, to }) {
  if (kind === "month") {
    return { from: iso(year, month, 1), to: iso(year, month, lastDay(year, month)), label: `${MONTHS[month - 1]} ${year}` };
  }
  if (kind === "quarter") {
    const first = (quarter - 1) * 3 + 1;
    return {
      from: iso(year, first, 1),
      to: iso(year, first + 2, lastDay(year, first + 2)),
      label: `Q${quarter} ${year} (${MONTHS[first - 1].slice(0, 3)}–${MONTHS[first + 1].slice(0, 3)})`,
    };
  }
  if (kind === "year") return { from: iso(year, 1, 1), to: iso(year, 12, 31), label: String(year) };
  if (!from || !to) return null;
  return { from, to, label: `${shortDate(from)} – ${shortDate(to)}` };
}

/* ------------------------------ formatting ------------------------------ */

const ghs = (n) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** For the screen and the PDF. */
export function show(v, f) {
  if (v === null || v === undefined || v === "") return "—";
  if (f === "money") return `GHS ${ghs(v)}`;
  if (f === "percent") return `${v}%`;
  if (f === "minutes") return `${v} min`;
  if (typeof v === "number") return v.toLocaleString("en-GB", { maximumFractionDigits: 2 });
  return String(v);
}

/** For the CSV: numbers stay numbers so Excel can add them up. */
function csvValue(v, f) {
  if (v === null || v === undefined) return "";
  if (f === "money") return Math.round(v * 100) / 100;
  if (f === "percent") return `${v}%`;
  return v;
}

export function csvCell(v) {
  if (typeof v === "number") return String(v);
  let s = String(v ?? "");
  // A cell starting with = + - @ could run as a formula in Excel.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A cell's value and format: summary cells are { v, f }, others use the column's. */
export const cellOf = (cell, column) =>
  cell !== null && typeof cell === "object" ? { v: cell.v, f: cell.f } : { v: cell, f: column?.f };

export function toCsv(report) {
  const lines = [
    ["Holy Family Catholic Hospital, Berekum: telemedicine report"],
    ["Period", report.label],
    ["From", report.from, "To", report.to],
    ["Prepared", formatDateTime(new Date(report.generatedAt))],
    [],
  ];
  for (const t of report.tables) {
    lines.push([t.title]);
    lines.push(t.columns.map((c) => c.label));
    for (const row of t.rows) {
      lines.push(row.map((cell, i) => {
        const { v, f } = cellOf(cell, t.columns[i]);
        return csvValue(v, f);
      }));
    }
    lines.push([]);
  }
  return `${BOM}${lines.map((l) => l.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export const fileName = (report, ext) => `telemedicine-report-${report.from}-to-${report.to}.${ext}`;
