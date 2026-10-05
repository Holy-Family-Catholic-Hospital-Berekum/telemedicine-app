import { useMemo, useState } from "react";
import { collection, orderBy, query, where } from "firebase/firestore";

import { db } from "../../src/firebase";
import { TYPE_LABELS, MODE_LABELS, OUTCOME_LABELS, formatDateTime } from "../../src/constants";
import { useFirestoreCollection } from "./hooks/useFirestoreCollection.js";
import { Pagination } from "../shared/pagination.jsx";
import { usePagination } from "../shared/usePagination.js";

// Refund requests from patients (only possible after the appointment day).
// Each row carries what's needed to refund by hand: the patient, how to
// reach and pay them, the amount paid, the suggested refund (a patient
// no-show keeps the hospital's share) and the Paystack reference. Refund
// in the Paystack dashboard (Transactions -> reference -> Refund) or by
// mobile money, then record the outcome here. Both steps are audited.

const OUTCOME_TEXT = { ...OUTCOME_LABELS, not_closed: "Not closed by the doctor" };

export default function RefundRequestsPanel({ callAdmin }) {
  const requestsQuery = useMemo(
    () =>
      query(
        collection(db, "refundRequests"),
        where("status", "==", "requested"),
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

  function open(request, decision) {
    setActive({ request, decision });
    setNote("");
    setAmount(String(request.suggestedRefund ?? request.amountPaid ?? ""));
  }

  async function confirm() {
    setBusy(true);
    try {
      await callAdmin("resolveRefundRequest", {
        consultationId: active.request.id,
        decision: active.decision,
        note: note.trim(),
        ...(active.decision === "refunded" ? { amountRefunded: Number(amount) } : {}),
      });
      setActive(null);
    } catch {
      // callAdmin shows the error banner
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <h2>Refund requests ({requests.length})</h2>
            <p>
              Refund in the Paystack dashboard (Transactions → search the
              reference → Refund) or by mobile money, then record it here.
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
                {pager.pageItems.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="admin-cell-name">{r.patientName || "—"}</div>
                      <div className="admin-cell-sub">{r.email}</div>
                      <div className="admin-cell-sub">Refund to: {r.refundPhone}</div>
                      {r.accountPhone && r.accountPhone !== r.refundPhone && (
                        <div className="admin-cell-sub">Account phone: {r.accountPhone}</div>
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
                        Suggested refund: {r.currency} {Number(r.suggestedRefund ?? 0).toFixed(2)}
                      </div>
                      {r.paystackReference && (
                        <div className="admin-cell-sub">Ref: {r.paystackReference}</div>
                      )}
                    </td>
                    <td style={{ maxWidth: 260, whiteSpace: "normal" }}>{r.reason}</td>
                    <td>
                      <div className="admin-row-actions">
                        <button className="btn btn-primary" onClick={() => open(r, "refunded")}>
                          Mark refunded
                        </button>
                        <button className="btn btn-outline" onClick={() => open(r, "declined")}>
                          Decline
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination {...pager} noun="requests" />
          </div>
        )}
      </section>

      {active && (
        <div className="admin-modal-backdrop" onClick={() => !busy && setActive(null)}>
          <div className="admin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>{active.decision === "refunded" ? "Record a refund" : "Decline this request?"}</h3>
            <p className="sub">
              {active.request.patientName} · {active.request.consultationId}
            </p>
            {active.decision === "refunded" && (
              <div className="admin-field">
                <label htmlFor="refund-amount">Amount refunded ({active.request.currency})</label>
                <input
                  id="refund-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  max={active.request.amountPaid}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            )}
            <div className="admin-field">
              <label htmlFor="refund-note">
                {active.decision === "refunded"
                  ? "Note (how it was refunded; kept in the audit log)"
                  : "Reason (the patient sees this)"}
              </label>
              <textarea
                id="refund-note"
                rows={2}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  active.decision === "refunded"
                    ? "e.g. Refunded via Paystack on 5 Oct"
                    : "e.g. The consultation took place as scheduled"
                }
              />
            </div>
            <div className="admin-modal-actions">
              <button className="btn btn-outline" onClick={() => setActive(null)} disabled={busy}>
                Cancel
              </button>
              <button
                className={`btn ${active.decision === "refunded" ? "btn-primary" : "btn-outline danger"}`}
                disabled={
                  busy ||
                  note.trim().length < 3 ||
                  (active.decision === "refunded" && !(Number(amount) > 0))
                }
                onClick={confirm}
              >
                {busy ? "Saving…" : active.decision === "refunded" ? "Record refund" : "Decline"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
