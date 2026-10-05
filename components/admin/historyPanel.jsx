import { useMemo, useState } from "react";
import { IconShield, IconSearch } from "./icons.jsx";
import { TYPE_LABELS, MODE_LABELS, OUTCOME_LABELS, formatDateTime } from "../../src/constants";
import { Pagination, LoadOlder } from "../shared/pagination.jsx";
import { usePagination } from "../shared/usePagination.js";

// Consultation history, written by markConsultationDone. It survives the
// deletion of the booking details, so it holds no date of birth, sex,
// location or phone: doctor, times, outcome and amounts only.
//
// Timing rules:
//   In person — starts at the scheduled time, ends when marked done.
//   Online    — starts when the call was actually initiated, ends when marked
//               done. Not when the call dropped: a call can end mid-way
//               without the consultation being finished.

// A session marked done before its scheduled start produces a negative
// duration. That means the record is inconsistent, not that the session was
// short, so show nothing rather than a misleading number.
const duration = (a, b) => {
  const mins = Math.round((new Date(b) - new Date(a)) / 60000);
  if (!Number.isFinite(mins) || mins < 0) return "—";
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "online", label: "Online" },
  { key: "in_person", label: "In person" },
];

export default function HistoryPanel({ history, window: win }) {
  const [mode, setMode] = useState("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () =>
      history
        .filter((h) => mode === "all" || h.mode === mode)
        .filter((h) => {
          const q = query.trim().toLowerCase();
          if (!q) return true;
          return [h.consultationId, h.type, h.doctorName, h.outcome]
            .join(" ")
            .toLowerCase()
            .includes(q);
        })
        .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)),
    [history, mode, query],
  );

  const completed = rows.filter((h) => h.outcome === "completed").length;
  const pager = usePagination(rows, 25, `${mode}|${query}`);

  return (
    <>
      <div className="admin-banner">
        <IconShield size={18} />
        <p>
          Doctor, timing, outcome and amount only. The patient's booking details
          (date of birth, sex, location, phone) are deleted when a consultation
          is closed.
        </p>
      </div>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <h2>Consultation history</h2>
            <p>
              {rows.length} {rows.length === 1 ? "session" : "sessions"} ·{" "}
              {completed} completed
            </p>
          </div>
          <div className="admin-search">
            <IconSearch size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by ID, type, doctor or outcome"
            />
          </div>
        </div>

        <div className="admin-subtabs">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`admin-subtab${mode === f.key ? " active" : ""}`}
              onClick={() => setMode(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="admin-empty">
            No consultations match these filters.
          </div>
        ) : (
          <div className="admin-panel-body">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Consultation ID</th>
                  <th>Type / mode</th>
                  <th>Doctor</th>
                  <th>Started</th>
                  <th>Ended</th>
                  <th>Duration</th>
                  <th>Outcome</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {pager.pageItems.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <span className="code-chip expired">
                        {h.consultationId}
                      </span>
                    </td>
                    <td>
                      <div>{TYPE_LABELS[h.type] ?? h.type}</div>
                      <div className="admin-cell-sub">{MODE_LABELS[h.mode] ?? h.mode}</div>
                    </td>
                    <td>{h.doctorName}</td>
                    <td className="admin-cell-sub">{formatDateTime(h.startedAt)}</td>
                    <td className="admin-cell-sub">{formatDateTime(h.endedAt)}</td>
                    <td>
                      <strong>{duration(h.startedAt, h.endedAt)}</strong>
                    </td>
                    <td>
                      <span
                        className={`status-pill ${
                          h.outcome === "completed" ? "confirmed" : "rejected"
                        }`}
                      >
                        {OUTCOME_LABELS[h.outcome] ?? h.outcome}
                      </span>
                    </td>
                    <td>
                      {h.currency || "GHS"} {Number(h.amountPaid ?? 0).toFixed(2)}
                      {h.refundOwed > 0 && (
                        <div className="admin-cell-sub">
                          Refund owed: {Number(h.refundOwed).toFixed(2)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination {...pager} noun="sessions" />
          </div>
        )}
        {win && <LoadOlder {...win} onLoadMore={win.loadMore} noun="sessions" />}
      </section>
    </>
  );
}
