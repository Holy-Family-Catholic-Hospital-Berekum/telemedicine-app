import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { httpsCallable } from "firebase/functions";
import { collection, query, where } from "firebase/firestore";
import { db, functions } from "../../src/firebase";
import { callableMessage, formatDateTime } from "../../src/constants";
import { useAuth } from "../../src/context/authContext.jsx";
import { useFirestoreCollection } from "./hooks/useFirestoreCollection.js";
import DateSelect from "../shared/dateSelect.jsx";
import "./metricsExport.css";

// "Export a report" on the Metrics & reports tab.
//
// The admin picks a month, quarter, year or their own dates; the server
// (functions/reports.js exportMetrics, admins only, audited) adds up that
// period and returns plain tables. From here they are saved as:
//   - CSV, which Excel opens (UTF-8 with BOM so "GHS"/names show correctly)
//   - PDF, by printing a report-only layout (the browser's "Save as PDF")
// Nothing is stored on the device. The report has no patient details.
//
// Two-admin rule (functions/reports.js): the admin who prepares a report
// can view it here, but the CSV / PDF unlock only after a DIFFERENT admin
// approves ("Waiting for your approval" below), within 24 hours, and the
// file data is fetched from the server once. The admin can cancel the
// report at any time.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const FIRST_YEAR = 2026;
// Byte-order mark: tells Excel the file is UTF-8.
const BOM = "﻿";
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const shortDate = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
};

/** { from, to, label } for the chosen period, or null if incomplete. */
function periodOf(kind, { year, month, quarter, from, to }) {
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
function show(v, f) {
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

function csvCell(v) {
  if (typeof v === "number") return String(v);
  let s = String(v ?? "");
  // A cell starting with = + - @ could run as a formula in Excel.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A cell's value and format: summary cells are { v, f }, others use the column's. */
const cellOf = (cell, column) =>
  cell !== null && typeof cell === "object" ? { v: cell.v, f: cell.f } : { v: cell, f: column?.f };

function toCsv(report) {
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

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fileName = (report, ext) => `telemedicine-report-${report.from}-to-${report.to}.${ext}`;

/* -------------------------------- tables -------------------------------- */

function ReportTable({ table }) {
  return (
    <table className="mx-table">
      <thead>
        <tr>
          {table.columns.map((c) => (
            <th key={c.label}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.length === 0 ? (
          <tr>
            <td colSpan={table.columns.length} className="mx-none">Nothing in this period.</td>
          </tr>
        ) : (
          table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => {
                const { v, f } = cellOf(cell, table.columns[i]);
                return <td key={i}>{show(v, f)}</td>;
              })}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

/** The PDF layout: only this is printed while body has .mx-printing. */
function PrintableReport({ report }) {
  return createPortal(
    <div className="mx-print">
      <header>
        <h1>Telemedicine report: {report.label}</h1>
        <p>
          Holy Family Catholic Hospital, Berekum · {shortDate(report.from)} to {shortDate(report.to)} · prepared{" "}
          {formatDateTime(new Date(report.generatedAt))}
        </p>
      </header>
      {report.tables.map((t) => (
        <section key={t.title}>
          <h2>{t.title}</h2>
          <ReportTable table={t} />
        </section>
      ))}
      <footer>
        Figures come from the telemedicine system's records. Consultations are counted by appointment date once
        closed; payments by the day Paystack confirmed them; refunds by the day they were paid back. No patient
        details are included.
      </footer>
    </div>,
    document.body,
  );
}

/* --------------------------------- panel --------------------------------- */

export default function MetricsExport() {
  const now = new Date();
  const thisYear = now.getUTCFullYear();
  const years = useMemo(() => {
    const list = [];
    for (let y = thisYear; y >= FIRST_YEAR; y -= 1) list.push(y);
    return list;
  }, [thisYear]);

  const [kind, setKind] = useState("month");
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [quarter, setQuarter] = useState(Math.floor(now.getUTCMonth() / 3) + 1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { user } = useAuth();
  // The report as prepared (for viewing), and the copy released after
  // approval (for the files).
  const [report, setReport] = useState(null);
  const [released, setReleased] = useState(null);
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(null); // request id being acted on
  const [error, setError] = useState(null);
  const [printing, setPrinting] = useState(false);

  // Open report requests (pending or approved): this admin's own, and
  // other admins' waiting for a decision.
  const openQuery = useMemo(
    () => query(collection(db, "reportRequests"), where("status", "in", ["pending", "approved"])),
    [],
  );
  const { data: open } = useFirestoreCollection(openQuery);
  const [openedAt] = useState(() => Date.now());
  const alive = (r) => {
    const until = r.status === "approved" ? r.usableUntil : r.expiresAt;
    return !until || new Date(until).getTime() > openedAt;
  };
  const mine = open
    .filter((r) => r.requestedByUid === user?.uid && alive(r))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
  const toApprove = open
    .filter((r) => r.status === "pending" && r.requestedByUid !== user?.uid && alive(r))
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

  // What's on screen: the released copy, or the one just prepared if it's
  // still this admin's open request.
  const viewing = released || (report && (!mine || mine.id === report.requestId) ? report : null);

  const period = periodOf(kind, { year, month, quarter, from, to });
  const stale = viewing && period && (viewing.from !== period.from || viewing.to !== period.to);

  const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);

  const prepare = async () => {
    if (!period) return;
    if (period.from > period.to) {
      setError("The end date is before the start date.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setReport(await call("exportMetrics", period));
      setReleased(null);
    } catch (err) {
      setError(callableMessage(err, "The report couldn't be prepared. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (requestId) => {
    setActing(requestId);
    setError(null);
    try {
      await call("cancelReportRequest", { requestId });
      setReport(null);
      setReleased(null);
    } catch (err) {
      setError(callableMessage(err, "The report couldn't be cancelled. Please try again."));
    } finally {
      setActing(null);
    }
  };

  const decide = async (requestId, decision) => {
    setActing(requestId);
    setError(null);
    try {
      await call("decideReportRequest", { requestId, decision });
    } catch (err) {
      setError(callableMessage(err, "That didn't go through. Please try again."));
    } finally {
      setActing(null);
    }
  };

  // After approval: fetch the report once, then make the file. Both formats
  // come from that one copy while this page stays open.
  const getFile = async (format) => {
    let copy = released;
    if (!copy) {
      setActing(mine.id);
      setError(null);
      try {
        copy = await call("downloadReport", { requestId: mine.id });
        setReleased(copy);
      } catch (err) {
        setError(callableMessage(err, "The report couldn't be downloaded. Please try again."));
        return;
      } finally {
        setActing(null);
      }
    }
    if (format === "csv") download(fileName(copy, "csv"), toCsv(copy));
    else setPrinting(true);
  };

  // Print only the report; the saved PDF takes its name from the title.
  useEffect(() => {
    if (!printing || !released) return undefined;
    const title = document.title;
    document.title = fileName(released, "pdf").replace(/\.pdf$/, "");
    document.body.classList.add("mx-printing");
    const done = () => setPrinting(false);
    window.addEventListener("afterprint", done);
    const t = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", done);
      document.body.classList.remove("mx-printing");
      document.title = title;
    };
  }, [printing, released]);

  const select = (value, onChange, options, label) => (
    <select className="admin-date-part" value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  );

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <div>
          <h2>Export a report</h2>
          <p>Revenue, bookings, quality of service and system figures for a period, as Excel (CSV) or PDF</p>
        </div>
      </div>

      <div className="mx-controls">
        <div className="mx-kinds" role="radiogroup" aria-label="Period">
          {[
            ["month", "Month"],
            ["quarter", "Quarter"],
            ["year", "Year"],
            ["custom", "Custom dates"],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              className={`btn ${kind === k ? "btn-secondary" : "btn-outline"}`}
              onClick={() => setKind(k)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mx-period">
          {kind === "month" && select(month, setMonth, MONTHS.map((m, i) => [i + 1, m]), "Month")}
          {kind === "quarter" &&
            select(quarter, setQuarter, [
              [1, "Q1 (Jan–Mar)"],
              [2, "Q2 (Apr–Jun)"],
              [3, "Q3 (Jul–Sep)"],
              [4, "Q4 (Oct–Dec)"],
            ], "Quarter")}
          {kind !== "custom" && select(year, setYear, years.map((y) => [y, String(y)]), "Year")}
          {kind === "custom" && (
            <>
              <label className="admin-cell-sub" htmlFor="mx-from">From</label>
              <DateSelect id="mx-from" value={from} onChange={setFrom} fromYear={FIRST_YEAR} toYear={thisYear} newestFirst selectClassName="admin-date-part" />
              <label className="admin-cell-sub" htmlFor="mx-to">To</label>
              <DateSelect id="mx-to" value={to} onChange={setTo} fromYear={FIRST_YEAR} toYear={thisYear} newestFirst selectClassName="admin-date-part" />
            </>
          )}
          <button type="button" className="btn btn-primary" disabled={!period || busy} onClick={prepare}>
            {busy ? "Preparing…" : "Prepare report"}
          </button>
        </div>
        {kind === "custom" && <p className="admin-cell-sub">Up to one year at a time.</p>}
        {error && <div className="admin-banner warn"><p>{error}</p></div>}
      </div>

      {toApprove.length > 0 && (
        <div className="mx-approvals">
          <h3>Waiting for your approval</h3>
          <p className="admin-cell-sub">
            Another admin prepared these reports. They can download them only after you approve.
          </p>
          <ul>
            {toApprove.map((r) => (
              <li key={r.id}>
                <span>
                  <strong>{r.label}</strong> · prepared by {r.requestedByName || "another admin"}
                  {r.createdAt ? ` · ${formatDateTime(r.createdAt)}` : ""}
                </span>
                <span className="mx-actions">
                  <button type="button" className="btn btn-primary" disabled={acting === r.id} onClick={() => decide(r.id, "approve")}>
                    Approve download
                  </button>
                  <button type="button" className="btn btn-outline" disabled={acting === r.id} onClick={() => decide(r.id, "reject")}>
                    Reject
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(mine || released) && (
        <div className="mx-result">
          <div className="mx-result-head">
            <div>
              <strong>{(released || mine).label}</strong>
              <span className="admin-cell-sub">
                {released
                  ? " · downloaded: both files can be saved while this page stays open"
                  : mine.status === "approved"
                    ? ` · approved by ${mine.decidedByName || "another admin"}: download within 24 hours (once)`
                    : " · waiting for another admin to approve the download"}
                {stale ? " · you've changed the period: prepare it again" : ""}
              </span>
            </div>
            <div className="mx-actions">
              <button
                type="button"
                className="btn btn-outline"
                disabled={!released && (mine?.status !== "approved" || acting === mine?.id)}
                onClick={() => getFile("csv")}
              >
                Download for Excel (CSV)
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={!released && (mine?.status !== "approved" || acting === mine?.id)}
                onClick={() => getFile("pdf")}
              >
                Save as PDF
              </button>
              {mine && !released && (
                <button type="button" className="btn btn-outline danger" disabled={acting === mine.id} onClick={() => cancel(mine.id)}>
                  Cancel report
                </button>
              )}
              {released && (
                <button type="button" className="btn btn-outline" onClick={() => setReleased(null)}>
                  Close
                </button>
              )}
            </div>
          </div>
          {viewing ? (
            <div className="mx-preview">
              {viewing.tables.map((t) => (
                <div key={t.title} className="mx-block">
                  <h3>{t.title}</h3>
                  <div className="mx-scroll">
                    <ReportTable table={t} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="admin-cell-sub">Prepare the report again to view it on this page.</p>
          )}
          {printing && released && <PrintableReport report={released} />}
        </div>
      )}
    </section>
  );
}
