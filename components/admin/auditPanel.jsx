import { useState } from "react";
import { IconSearch, IconShield } from "./icons.jsx";
import { actorLabel } from "./actorName.js";
import { Pagination, LoadOlder } from "../shared/pagination.jsx";
import { usePagination } from "../shared/usePagination.js";

// auditLog collection (section 5). Records that an action happened and who
// did it — never the patient details from that session.
export default function AuditPanel({ entries, window: win, names }) {
  const [query, setQuery] = useState("");

  const rows = entries.filter((e) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [
      actorLabel(e.actorId, names).name,
      e.actorId,
      e.actorRole,
      e.action,
      e.targetId,
      e.targetType === "user" ? actorLabel(e.targetId, names).name : "",
      e.reason,
    ]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
  const pager = usePagination(rows, 25, query);

  return (
    <>
      <div className="admin-banner">
        <IconShield size={18} />
        <p>
          This log is permanent: nobody, including admins, can edit or delete
          an entry. It covers payments, scheduling, account changes and every
          play, download or deletion of a call recording. Review it regularly,
          and look into any entry marked as failed.
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
                {pager.pageItems.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div className="admin-cell-name" title={e.actorId}>
                        {actorLabel(e.actorId, names).name}
                      </div>
                      {e.actorRole && e.actorRole !== "system" && (
                        <div className="admin-cell-sub">{e.actorRole}</div>
                      )}
                    </td>
                    <td>
                      {e.action}
                      {e.result && e.result !== "success" && (
                        <div className="admin-cell-sub" style={{ color: "var(--color-danger)" }}>
                          {e.result}
                        </div>
                      )}
                      {e.reason && <div className="admin-cell-sub">Reason: {e.reason}</div>}
                    </td>
                    <td>
                      {e.targetType === "user" && actorLabel(e.targetId, names).known ? (
                        <span title={e.targetId}>{actorLabel(e.targetId, names).name}</span>
                      ) : (
                        <span className="code-chip">{e.targetId}</span>
                      )}
                    </td>
                    <td className="admin-cell-sub">
                      {e.timestamp ? new Date(e.timestamp).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination {...pager} noun="entries" />
          </div>
        )}
        {win && <LoadOlder {...win} onLoadMore={win.loadMore} noun="entries" />}
      </section>
    </>
  );
}
