import { useState } from "react";
import { IconSearch, IconShield } from "./icons.jsx";

// auditLog collection (section 5). Records that an action happened and who
// did it — never the patient details from that session.
export default function AuditPanel({ entries }) {
  const [query, setQuery] = useState("");

  const rows = entries.filter((e) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [e.actorId, e.action, e.targetId]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  return (
    <>
      <div className="admin-banner">
        <IconShield size={18} />
        <p>
          This log is permanent and is not affected when session data is erased.
          Review it periodically — a weekly sample of confirmed payments checked
          by a second person is the recommended practice.
        </p>
      </div>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <h2>Staff action log</h2>
            <p>Every confirmation, rejection, schedule and closed session</p>
          </div>
          <div className="admin-search">
            <IconSearch size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by staff member, action or reference"
            />
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="admin-empty">No entries match that search.</div>
        ) : (
          <div className="admin-panel-body">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Staff member</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div className="admin-cell-name">{e.actorId}</div>
                    </td>
                    <td>{e.action}</td>
                    <td>
                      <span className="code-chip">{e.targetId}</span>
                    </td>
                    <td className="admin-cell-sub">
                      {new Date(e.timestamp).toLocaleString()}
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
