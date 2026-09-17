import { useState } from "react";
import ConfirmDialog from "./confirmDialog.jsx";
import PaymentVerificationModal from "./paymentVerificationModal.jsx";
import { IconCheck, IconX, IconAlert } from "./icons.jsx";

// The queue below deliberately shows only who submitted and when. The MoMo
// name, amount and reference stay hidden so the admin has to read them off
// the hospital's SMS rather than off this screen.
const maskRef = (code) => `${code.slice(0, 4)}${"•".repeat(5)}`;

export default function PaymentsPanel({ claims, ledger, onConfirm, onReject }) {
  const [verifying, setVerifying] = useState(false);
  const [rejecting, setRejecting] = useState(null);

  return (
    <>
      <div className="ledger-grid">
        <div className="ledger-card">
          <span className="ledger-count">{ledger.available}</span>
          <span className="ledger-label">Available codes</span>
          <span className="ledger-note">Issued, not yet claimed</span>
        </div>
        <div className="ledger-card is-pending">
          <span className="ledger-count">{ledger.pending}</span>
          <span className="ledger-label">Awaiting verification</span>
          <span className="ledger-note">Claimed, needs your check</span>
        </div>
        <div className="ledger-card is-confirmed">
          <span className="ledger-count">
            {ledger.confirmed.toLocaleString()}
          </span>
          <span className="ledger-label">Confirmed codes</span>
          <span className="ledger-note">Permanent — can never be reused</span>
        </div>
      </div>

      <div className="admin-banner">
        <IconAlert size={18} />
        <p>
          Work from the hospital's MoMo SMS, not from this screen. Open Verify a
          payment, type what the message says, and the system compares it with
          what the patient submitted. Your name is recorded against every
          confirmation.
        </p>
      </div>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <h2>Submitted payments</h2>
            <p>
              Patients waiting on verification — their submitted details stay
              hidden until you enter yours
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setVerifying(true)}
            disabled={claims.length === 0}
          >
            <IconCheck size={14} /> Verify a payment
          </button>
        </div>

        {claims.length === 0 ? (
          <div className="admin-empty">
            Every submitted payment has been verified.
          </div>
        ) : (
          <div className="admin-panel-body">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Consultation</th>
                  <th>Reference code</th>
                  <th>Submitted</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.referenceCode}>
                    <td>
                      <div className="admin-cell-name">{c.patientName}</div>
                      <div className="admin-cell-sub">{c.phone}</div>
                    </td>
                    <td>
                      <div>{c.type}</div>
                      <div className="admin-cell-sub">{c.mode}</div>
                    </td>
                    <td>
                      <span className="code-chip pending masked">
                        {maskRef(c.referenceCode)}
                      </span>
                    </td>
                    <td className="admin-cell-sub">
                      {new Date(c.claimedAt).toLocaleString()}
                    </td>
                    <td>
                      <div className="admin-row-actions">
                        <button
                          className="btn btn-outline danger"
                          onClick={() => setRejecting(c)}
                        >
                          <IconX size={14} /> Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {verifying && (
        <PaymentVerificationModal
          claims={claims}
          onClose={() => setVerifying(false)}
          onConfirm={(claim, extra) => {
            onConfirm(claim, extra);
            setVerifying(false);
          }}
        />
      )}

      {rejecting && (
        <ConfirmDialog
          title="Reject this submission"
          body={
            <>
              Rejecting {rejecting.patientName}'s submission releases their
              reference code back to available, so the real payer can still use
              it. The rejection is recorded against your name.
            </>
          }
          confirmLabel="Reject"
          tone="danger"
          onConfirm={() => {
            onReject(rejecting);
            setRejecting(null);
          }}
          onClose={() => setRejecting(null)}
        />
      )}
    </>
  );
}
