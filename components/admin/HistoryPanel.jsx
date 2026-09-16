import { useMemo, useState } from "react";
import { IconShield, IconSearch } from "./icons.jsx";

// Consultation history — permanent and anonymised.
//
// This survives session-close erasure, so it must never carry a patient name,
// phone, email or anything that identifies who was seen. It holds timing and
// outcome only. The consultation ID is kept because it is expired and dead
// once a session is marked done; it links nothing back to a person.
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
  { key: "Online", label: "Online" },
  { key: "In person", label: "In person" },
];

export default function HistoryPanel({ history }) {
  const [mode, setMode] = useState("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () =>
      history
        .filter((h) => mode === "all" || h.mode === mode)
        .filter((h) => {
          const q = query.trim().toLowerCase();
          if (!q) return true;
          return [h.consultationId, h.type, h.doctorOrDept, h.outcome]
            .join(" ")
            .toLowerCase()
            .includes(q);
        })
        .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)),
    [history, mode, query],
  );

  const completed = rows.filter((h) => h.outcome === "Completed").length;

  return (
    <>
      <div className="admin-banner">
        <IconShield size={18} />
        <p>
          Timing and outcome only. Patient names, phone numbers and booking
          records are erased when a consultation is marked done, so this history
          cannot be used to look up who was seen.
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
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <span className="code-chip expired">
                        {h.consultationId}
                      </span>
                    </td>
                    <td>
                      <div>{h.type}</div>
                      <div className="admin-cell-sub">{h.mode}</div>
                    </td>
                    <td>{h.doctorOrDept}</td>
                    <td className="admin-cell-sub">
                      {new Date(h.startedAt).toLocaleString()}
                    </td>
                    <td className="admin-cell-sub">
                      {new Date(h.endedAt).toLocaleString()}
                    </td>
                    <td>
                      <strong>{duration(h.startedAt, h.endedAt)}</strong>
                    </td>
                    <td>
                      <span
                        className={`status-pill ${
                          h.outcome === "Completed" ? "confirmed" : "rejected"
                        }`}
                      >
                        {h.outcome}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
