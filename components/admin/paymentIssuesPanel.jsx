import { useMemo, useState } from "react";
import { collection, orderBy, query, where } from "firebase/firestore";

import { db } from "../../src/firebase";
import { formatDateTime } from "../../src/constants";
import { useFirestoreCollection } from "./hooks/useFirestoreCollection.js";
import { IconAlert } from "./icons.jsx";
import { Pagination } from "../shared/pagination.jsx";
import { usePagination } from "../shared/usePagination.js";

// Payments Paystack took that couldn't be applied to a booking: a second
// successful attempt on an already-paid booking, a payment that arrived
// after the booking was removed, or an amount that didn't match. The server
// refunds each one in full through Paystack automatically (payments.js
// startIssueRefund) and follows it until Paystack confirms (refundSync.js).
// Rows here are the ones still under way or that Paystack refused: retry,
// or record a refund made another way (audited). Renders nothing while
// there are none.

const ISSUE_STATUS = {
  refund_due: "Waiting to refund",
  refund_starting: "Sending to Paystack…",
  refund_processing: "Refunding through Paystack…",
  refund_failed: "Paystack couldn't refund",
};

const REASONS = {
  duplicate_payment: "Paid twice for the same booking",
  no_matching_booking: "Paid after the booking expired or was removed",
  amount_mismatch: "Amount didn't match the booking",
};

export default function PaymentIssuesPanel({ callAdmin }) {
  const issuesQuery = useMemo(
    () =>
      query(
        collection(db, "paymentIssues"),
        where("status", "in", ["refund_due", "refund_starting", "refund_processing", "refund_failed"]),
        orderBy("createdAt", "desc"),
      ),
    [],
  );
  const { data: issues, error } = useFirestoreCollection(issuesQuery);
  const pager = usePagination(issues, 25);
  const [resolving, setResolving] = useState(null); // { issue, method }
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (error || issues.length === 0) return null;

  function open(issue, method) {
    setResolving({ issue, method });
    setNote("");
  }
  const manual = resolving?.method === "manual";
  const ri = resolving?.issue;

  async function confirm() {
    setBusy(true);
    try {
      await callAdmin("resolvePaymentIssue", {
        reference: resolving.issue.id,
        method: resolving.method,
        ...(resolving.method === "manual" ? { note: note.trim() } : {}),
      });
      setResolving(null);
      setNote("");
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
            <h2>Automatic refunds ({issues.length})</h2>
            <p>
              Payments we couldn't use (paid twice, or paid after the booking
              expired) are refunded in full through Paystack automatically. If
              Paystack refuses one, retry it or record a refund made another way.
            </p>
          </div>
        </div>
        <div className="admin-panel-body">
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Reason</th>
                <th>Amount</th>
                <th>Paystack reference</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pager.pageItems.map((i) => (
                <tr key={i.id}>
                  <td className="admin-cell-sub">{formatDateTime(i.createdAt)}</td>
                  <td>
                    <IconAlert size={13} /> {REASONS[i.reason] ?? i.reason}
                  </td>
                  <td>
                    {i.currency} {Number(i.amount).toFixed(2)}
                  </td>
                  <td>
                    <span className="code-chip">{i.reference}</span>
                  </td>
                  <td>
                    {ISSUE_STATUS[i.status] ?? i.status}
                    {i.lastRefundError && (
                      <div className="admin-cell-sub" style={{ color: "var(--color-danger)" }}>
                        Paystack: {i.lastRefundError}
                      </div>
                    )}
                  </td>
                  <td>
                    {i.status === "refund_due" || i.status === "refund_failed" ? (
                      <div className="admin-row-actions">
                        <button className="btn btn-primary" onClick={() => open(i, "paystack")}>
                          Retry refund
                        </button>
                        <button className="btn btn-outline" onClick={() => open(i, "manual")}>
                          Record manual refund
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination {...pager} noun="payments" />
        </div>
      </section>

      {resolving && (
        <div className="admin-modal-backdrop" onClick={() => !busy && setResolving(null)}>
          <div className="admin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>{manual ? "Record a manual refund?" : "Refund through Paystack?"}</h3>
            <p className="sub">
              {manual
                ? `Only do this after ${ri.currency} ${Number(ri.amount).toFixed(2)} (${ri.reference}) has been refunded another way.`
                : `Paystack refunds ${ri.currency} ${Number(ri.amount).toFixed(2)} (${ri.reference}) to the original payment.`}
            </p>
            {manual && (
            <div className="admin-field">
              <label htmlFor="refund-note">Note (kept in the audit log)</label>
              <textarea
                id="refund-note"
                rows={2}
                maxLength={300}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Sent by mobile money on 3 Oct"
              />
            </div>
            )}
            <div className="admin-modal-actions">
              <button className="btn btn-outline" onClick={() => setResolving(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy || (manual && note.trim().length < 3)} onClick={confirm}>
                {busy ? "Working…" : manual ? "Record refund" : "Refund"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
