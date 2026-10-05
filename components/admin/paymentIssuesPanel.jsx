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
// after the booking was removed, or an amount that didn't match. Each one
// needs a refund through the Paystack dashboard, then "Mark refunded" here
// (audited). Renders nothing while there are none.

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
        where("status", "==", "refund_due"),
        orderBy("createdAt", "desc"),
      ),
    [],
  );
  const { data: issues, error } = useFirestoreCollection(issuesQuery);
  const pager = usePagination(issues, 25);
  const [resolving, setResolving] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (error || issues.length === 0) return null;

  async function confirm() {
    setBusy(true);
    try {
      await callAdmin("resolvePaymentIssue", { reference: resolving.id, note: note.trim() });
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
            <h2>Refunds needed ({issues.length})</h2>
            <p>
              Refund each one in the Paystack dashboard (Transactions → search
              the reference → Refund), then mark it here.
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
                    <button className="btn btn-outline" onClick={() => setResolving(i)}>
                      Mark refunded
                    </button>
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
            <h3>Mark as refunded?</h3>
            <p className="sub">
              Only do this after the refund for {resolving.currency}{" "}
              {Number(resolving.amount).toFixed(2)} ({resolving.reference}) has
              been issued in Paystack.
            </p>
            <div className="admin-field">
              <label htmlFor="refund-note">Note (kept in the audit log)</label>
              <textarea
                id="refund-note"
                rows={2}
                maxLength={300}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Refunded in Paystack on 3 Oct"
              />
            </div>
            <div className="admin-modal-actions">
              <button className="btn btn-outline" onClick={() => setResolving(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy || note.trim().length < 3} onClick={confirm}>
                {busy ? "Saving…" : "Mark refunded"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
