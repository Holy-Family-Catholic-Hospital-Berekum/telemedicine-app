import { useState } from "react";
import { IconAlert, IconCheck, IconX } from "./icons.jsx";

// Blind double-entry verification.
//
// The admin types what the hospital's MoMo SMS says. This modal never shows
// the patient's submitted values, and the lookup happens on the reference
// code the admin types — not on a row they picked off a list. That is what
// makes the check meaningful: if the admin could see the patient's answers,
// copying them across would defeat it.
//
// IMPORTANT: matchClaim() below is a client-side stand-in so this is testable
// now. Before launch it must move into the confirmPayment Cloud Function —
// a comparison that runs in the browser can be bypassed with devtools, and
// the client is never allowed to set paymentStatus (architecture 6.1).
//
// The transaction ID is recorded for the audit trail but is NOT matched:
// on Ghanaian MoMo the sender and recipient see different references for
// the same transfer, so matching it would fail on legitimate payments.

const normName = (s) =>
  s.trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");

const normAmount = (s) => {
  const n = parseFloat(String(s).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const normRef = (s) => s.trim().toUpperCase().replace(/\s+/g, "");

// Returns { found, claim, checks } — never mutates anything.
export function matchClaim(form, claims) {
  const ref = normRef(form.referenceCode);
  const claim = claims.find((c) => normRef(c.referenceCode) === ref);

  if (!claim) return { found: false, claim: null, checks: [] };

  const checks = [
    {
      label: "Reference code",
      ok: true,
      detail: claim.referenceCode,
    },
    {
      label: "Sender name",
      ok: normName(form.senderName) === normName(claim.momoName),
      detail: null,
    },
    {
      label: "Amount",
      ok: normAmount(form.amount) === normAmount(claim.amount),
      detail: null,
    },
  ];

  return { found: true, claim, checks };
}

const EMPTY = {
  referenceCode: "",
  senderName: "",
  amount: "",
  transactionId: "",
};

export default function PaymentVerificationModal({ claims, onConfirm, onClose }) {
  const [form, setForm] = useState(EMPTY);
  const [result, setResult] = useState(null);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setResult(null);
  };

  const complete =
    form.referenceCode.trim() &&
    form.senderName.trim() &&
    form.amount.trim() &&
    form.transactionId.trim();

  const check = () => setResult(matchClaim(form, claims));

  const allOk = result?.found && result.checks.every((c) => c.ok);

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div
        className="admin-modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="Verify a payment"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Verify a payment</h3>
        <p className="sub">
          Type the details exactly as they appear in the hospital's MoMo SMS or
          merchant statement. The patient's own submission is hidden until you
          have entered yours.
        </p>

        <div className="verify-grid">
          <div className="admin-field">
            <label htmlFor="v-ref">Reference code</label>
            <input
              id="v-ref"
              value={form.referenceCode}
              onChange={set("referenceCode")}
              placeholder="HFH-XXXXX"
              autoComplete="off"
            />
          </div>
          <div className="admin-field">
            <label htmlFor="v-name">Sender name</label>
            <input
              id="v-name"
              value={form.senderName}
              onChange={set("senderName")}
              placeholder="As shown in the SMS"
              autoComplete="off"
            />
          </div>
          <div className="admin-field">
            <label htmlFor="v-amt">Amount (GHS)</label>
            <input
              id="v-amt"
              value={form.amount}
              onChange={set("amount")}
              placeholder="120.00"
              inputMode="decimal"
              autoComplete="off"
            />
          </div>
          <div className="admin-field">
            <label htmlFor="v-txn">Transaction ID</label>
            <input
              id="v-txn"
              value={form.transactionId}
              onChange={set("transactionId")}
              placeholder="From the hospital's SMS"
              autoComplete="off"
            />
            <span className="field-hint">
              Recorded for the audit trail. Not matched — the sender's
              reference differs from the hospital's.
            </span>
          </div>
        </div>

        {result && !result.found && (
          <div className="match-result bad">
            <IconAlert size={16} />
            <div>
              <strong>No pending submission for that reference code.</strong>
              <p>
                Check the code in the SMS. If the patient has not submitted
                their side yet, there is nothing to confirm.
              </p>
            </div>
          </div>
        )}

        {result?.found && (
          <div className={`match-result ${allOk ? "ok" : "bad"}`}>
            {allOk ? <IconCheck size={16} /> : <IconAlert size={16} />}
            <div>
              <strong>
                {allOk
                  ? "Everything matches."
                  : "These details do not match the patient's submission."}
              </strong>
              <ul className="match-list">
                {result.checks.map((c) => (
                  <li key={c.label} className={c.ok ? "ok" : "bad"}>
                    {c.ok ? <IconCheck size={13} /> : <IconX size={13} />}
                    <span>{c.label}</span>
                    {c.detail && <em>{c.detail}</em>}
                  </li>
                ))}
              </ul>
              {!allOk && (
                <p>
                  Do not confirm. Re-read the SMS, then try again. Repeated
                  mismatches on the same code are recorded in the activity log.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="admin-modal-actions">
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          {!allOk ? (
            <button
              className="btn btn-secondary"
              disabled={!complete}
              onClick={check}
            >
              Check details
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() =>
                onConfirm(result.claim, {
                  transactionId: form.transactionId.trim(),
                })
              }
            >
              Confirm payment
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
