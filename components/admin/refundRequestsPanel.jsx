import { useMemo, useState } from "react";
import { collection, orderBy, query, where } from "firebase/firestore";

import { db } from "../../src/firebase";
import { TYPE_LABELS, MODE_LABELS, OUTCOME_LABELS, formatDateTime } from "../../src/constants";
import { useFirestoreCollection } from "./hooks/useFirestoreCollection.js";
import { Pagination } from "../shared/pagination.jsx";
import { usePagination } from "../shared/usePagination.js";

// Refund requests from patients who didn't attend (functions/refunds.js).
//   Approve & refund  one click: Paystack sends the amount (pre-filled with
//                     the suggested refund, editable) back to the patient's
//                     original payment (wallet or card). The row then shows
//                     "Refunding…" until Paystack confirms (refundSync.js).
//   Record manual     the refund was made another way (e.g. Paystack refused
//                     it): record the amount and how.
//   Decline           with a reason.
// Approving a refund for a booking that's still open closes the
// consultation. Every step is audited.

const OUTCOME_TEXT = {
  ...OUTCOME_LABELS,
  no_show: "Missed (no-show)",
  not_closed: "Not attended, not closed by the doctor",
  doctor_unavailable: "Doctor couldn't make it (full refund)",
  call_incomplete: "Call couldn't be completed (full refund)",
};
const STATUS = {
  requested: { label: "Waiting for a decision", tone: "" },
  refund_starting: { label: "Sending to Paystack…", tone: "" },
  processing: { label: "Refunding through Paystack…", tone: "" },
  failed: { label: "Paystack couldn't refund", tone: "rejected" },
};

export default function RefundRequestsPanel({ callAdmin }) {
  const requestsQuery = useMemo(
    () =>
      query(
        collection(db, "refundRequests"),
        where("status", "in", Object.keys(STATUS)),
        orderBy("createdAt", "desc"),
      ),
    [],
  );
  const { data: requests, error } = useFirestoreCollection(requestsQuery);
  const pager = usePagination(requests, 25);
  const [active, setActive] = useState(null); // { request, decision }
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  if (error) return null;
  const waiting = requests.filter((r) => r.status === "requested" || r.status === "failed").length;

  function open(request, decision) {
    setActive({ request, decision });
    setNote("");
    setAmount(String(request.amountRefunded ?? request.suggestedRefund ?? request.amountPaid ?? ""));
  }

  async function confirm() {
    setBusy(true);
    try {
      await callAdmin("resolveRefundRequest", {
        consultationId: active.request.id,
        decision: active.decision,
        note: note.trim(),
        ...(active.decision !== "declined" ? { amount: Number(amount) } : {}),
      });
      setActive(null);
    } catch {
      // callAdmin shows the error banner
    } finally {
      setBusy(false);
    }
  }

  const a = active?.request;
  const needsNote = active && active.decision !== "refund";
  const amountOk = !active || active.decision === "declined" || (Number(amount) > 0 && Number(amount) <= Number(a.amountPaid));

  return (
    <>
      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <h2>Refund requests ({waiting} waiting)</h2>
            <p>
              Approving sends the refund through Paystack to the patient's
              original payment (mobile money wallet or card). Check the amount:
              a no-show's suggested refund already takes off the share kept.
            </p>
          </div>
        </div>
        {requests.length === 0 ? (
          <div className="admin-empty">No refund requests waiting.</div>
        ) : (
          <div className="admin-panel-body">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Consultation</th>
                  <th>Paid / suggested</th>
                  <th>Reason</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pager.pageItems.map((r) => {
                  const status = STATUS[r.status] ?? { label: r.status, tone: "" };
                  const actionable = r.status === "requested" || r.status === "failed";
                  return (
                    <tr key={r.id}>
                      <td>
                        <div className="admin-cell-name">{r.patientName || "—"}</div>
                        <div className="admin-cell-sub">{r.email}</div>
                        {(r.refundPhone || r.accountPhone) && (
                          <div className="admin-cell-sub">Phone: {r.refundPhone || r.accountPhone}</div>
                        )}
                        <div className="admin-cell-sub">Requested {formatDateTime(r.createdAt)}</div>
                      </td>
                      <td>
                        <span className="code-chip">{r.consultationId}</span>
                        <div className="admin-cell-sub">
                          {TYPE_LABELS[r.type] ?? r.type} · {MODE_LABELS[r.mode] ?? r.mode}
                        </div>
                        <div className="admin-cell-sub">
                          {r.doctorName || "—"} · {formatDateTime(r.scheduledTime)}
                        </div>
                        <div className="admin-cell-sub">{OUTCOME_TEXT[r.outcome] ?? r.outcome}</div>
                      </td>
                      <td>
                        <div>
                          {r.currency} {Number(r.amountPaid).toFixed(2)}
                        </div>
                        <div className="admin-cell-sub">
                          Suggested: {r.currency} {Number(r.suggestedRefund ?? 0).toFixed(2)}
                        </div>
                        {r.paystackReference && <div className="admin-cell-sub">Ref: {r.paystackReference}</div>}
                      </td>
                      <td style={{ maxWidth: 260, whiteSpace: "normal" }}>
                        {r.reason}
                        <div className="admin-cell-sub" style={{ marginTop: 6 }}>
                          <span className={`status-pill ${status.tone}`}>{status.label}</span>
                        </div>
                        {r.lastRefundError && (
                          <div className="admin-cell-sub" style={{ color: "var(--color-danger)" }}>
                            Paystack: {r.lastRefundError}
                          </div>
                        )}
                      </td>
                      <td>
                        {actionable ? (
                          <div className="admin-row-actions">
                            <button className="btn btn-primary" onClick={() => open(r, "refund")}>
                              {r.status === "failed" ? "Retry refund" : "Approve & refund"}
                            </button>
                            <button className="btn btn-outline" onClick={() => open(r, "manual")}>
                              Record manual refund
                            </button>
                            <button className="btn btn-outline" onClick={() => open(r, "declined")}>
                              Decline
                            </button>
                          </div>
                        ) : (
                          <span className="admin-cell-sub">
                            {r.amountRefunded ? `${r.currency} ${Number(r.amountRefunded).toFixed(2)}` : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination {...pager} noun="requests" />
          </div>
        )}
      </section>

      {active && (
        <div className="admin-modal-backdrop" onClick={() => !busy && setActive(null)}>
          <div className="admin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>
              {active.decision === "refund"
                ? "Refund through Paystack?"
                : active.decision === "manual"
                  ? "Record a manual refund"
                  : "Decline this request?"}
            </h3>
            <p className="sub">
              {a.patientName} · {a.consultationId}
              {active.decision === "refund" &&
                ". The money goes back to the patient's original payment (wallet or card). Approving also closes the consultation if it's still open."}
            </p>
            {active.decision !== "declined" && (
              <div className="admin-field">
                <label htmlFor="refund-amount">
                  Amount ({a.currency}, at most {Number(a.amountPaid).toFixed(2)})
                </label>
                <input
                  id="refund-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={a.amountPaid}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <p className="cp-help">
                  Suggested {a.currency} {Number(a.suggestedRefund ?? 0).toFixed(2)}
                  {a.outcome === "no_show" ? " (paid minus the share kept for a no-show)" : ""}.
                </p>
              </div>
            )}
            <div className="admin-field">
              <label htmlFor="refund-note">
                {active.decision === "manual"
                  ? "How it was refunded (kept in the audit log)"
                  : active.decision === "declined"
                    ? "Reason (the patient sees this)"
                    : "Note (optional, kept in the audit log)"}
              </label>
              <textarea
                id="refund-note"
                rows={2}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  active.decision === "manual"
                    ? "e.g. Sent by mobile money to 024… on 5 Oct"
                    : active.decision === "declined"
                      ? "e.g. The consultation took place as scheduled"
                      : ""
                }
              />
            </div>
            <div className="admin-modal-actions">
              <button className="btn btn-outline" onClick={() => setActive(null)} disabled={busy}>
                Cancel
              </button>
              <button
                className={`btn ${active.decision === "declined" ? "btn-outline danger" : "btn-primary"}`}
                disabled={busy || !amountOk || (needsNote && note.trim().length < 3)}
                onClick={confirm}
              >
                {busy
                  ? "Working…"
                  : active.decision === "refund"
                    ? `Refund ${a.currency} ${Number(amount || 0).toFixed(2)}`
                    : active.decision === "manual"
                      ? "Record refund"
                      : "Decline"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
