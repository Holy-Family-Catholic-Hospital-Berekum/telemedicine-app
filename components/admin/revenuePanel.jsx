import { useMemo, useState } from "react";
import { IconInfo } from "./icons.jsx"; // ASSUMPTION: swap for whatever icons.jsx exports for an informational (non-warning) banner — see note below

// Revenue is a reporting view now, not a fraud-reconciliation tool.
//
// Payments are confirmed automatically by Paystack at the moment of
// payment — no admin action creates or verifies a `confirmedPayments`
// doc. That removes the original threat this panel was built around
// (an admin fraudulently self-confirming a payment), so there is no
// more "who confirmed it" breakdown, and no more MoMo-statement
// variance calculator built to catch that.
//
// What's left: a summary of what Paystack has reported paid, and an
// optional reconciliation against Paystack's own settlement total
// (from the Paystack dashboard/payout report) — the one figure that
// still comes from outside this system entirely.
//
// ASSUMPTIONS (adjust to match your actual Paystack write shape):
// - `payments` docs (the `confirmedPayments` collection, per admin.jsx)
//   are written by a Paystack webhook / Cloud Function, shaped as:
//     { id, amount, type, reference, paidAt, channel? }
//   `reference` is Paystack's transaction reference (for looking a
//   payment up in the Paystack dashboard if something looks off).
//   `channel` (card / mobile_money / etc.) is optional — the by-type
//   breakdown below still works if it's absent, but drop the "Channel"
//   column if you don't have it.
// - Field is `paidAt`, matching admin.jsx's
//   `orderBy("paidAt", "desc")` on this collection — was `confirmedAt`
//   before, which no longer matches admin.jsx's query.

const ghs = (n) =>
  `GHS ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const RANGES = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "all", label: "All time" },
];

export default function RevenuePanel({ payments }) {
  const [range, setRange] = useState("7");
  const [settlementTotal, setSettlementTotal] = useState("");
  // When the tab was opened: the "last N days" window is relative to it.
  const [openedAt] = useState(() => Date.now());

  const rows = useMemo(() => {
    if (range === "all") return payments;
    const days = parseInt(range, 10);
    const cutoff = openedAt - days * 86400000;
    return payments.filter((p) => new Date(p.paidAt).getTime() >= cutoff);
  }, [payments, range, openedAt]);

  const total = rows.reduce((s, p) => s + p.amount, 0);

  const byType = useMemo(() => {
    const m = new Map();
    rows.forEach((p) => {
      const cur = m.get(p.type) ?? { count: 0, amount: 0 };
      m.set(p.type, { count: cur.count + 1, amount: cur.amount + p.amount });
    });
    return [...m.entries()];
  }, [rows]);

  const byChannel = useMemo(() => {
    const m = new Map();
    rows.forEach((p) => {
      const key = p.channel || "Unspecified";
      const cur = m.get(key) ?? { count: 0, amount: 0 };
      m.set(key, { count: cur.count + 1, amount: cur.amount + p.amount });
    });
    return [...m.entries()].sort((a, b) => b[1].amount - a[1].amount);
  }, [rows]);

  const entered = parseFloat(settlementTotal.replace(/[^\d.]/g, ""));
  const hasSettlement = Number.isFinite(entered);
  const variance = hasSettlement ? entered - total : null;
  const reconciled = hasSettlement && Math.abs(variance) < 0.01;

  return (
    <>
      <div className="admin-banner">
        <IconInfo size={18} />
        <p>
          Payments are confirmed automatically by Paystack — nothing here is
          entered by an admin. The figures below are what Paystack has reported
          paid; use the box at the bottom to compare against Paystack's own
          settlement total for the period, in case a payment shows here but
          hasn't actually settled yet (or vice versa).
        </p>
      </div>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <h2>Confirmed payments</h2>
            <p>Fees confirmed paid by Paystack</p>
          </div>
          <div className="admin-subtabs bare">
            {RANGES.map((r) => (
              <button
                key={r.key}
                className={`admin-subtab${range === r.key ? " active" : ""}`}
                onClick={() => setRange(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="summary-grid">
          <div>
            <span className="summary-value">{ghs(total)}</span>
            <span className="summary-label">Total confirmed</span>
          </div>
          <div>
            <span className="summary-value">{rows.length}</span>
            <span className="summary-label">Payments</span>
          </div>
          {byType.map(([type, v]) => (
            <div key={type}>
              <span className="summary-value">{ghs(v.amount)}</span>
              <span className="summary-label">
                {type} · {v.count}
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="metrics-grid">
        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>By payment channel</h2>
              <p>Card, mobile money, etc. — over the selected period</p>
            </div>
          </div>
          {byChannel.length === 0 ? (
            <div className="admin-empty">
              No payments were confirmed in this period.
            </div>
          ) : (
            <div className="admin-panel-body">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Payments</th>
                    <th>Total</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {byChannel.map(([channel, v]) => (
                    <tr key={channel}>
                      <td className="admin-cell-name">{channel}</td>
                      <td>{v.count}</td>
                      <td>
                        <strong>{ghs(v.amount)}</strong>
                      </td>
                      <td>
                        <div className="share-bar">
                          <span
                            style={{
                              width: `${total ? (v.amount / total) * 100 : 0}%`,
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Reconcile with Paystack settlement</h2>
              <p>Compare against Paystack's own payout report</p>
            </div>
          </div>
          <div className="reconcile-box">
            <div className="admin-field">
              <label htmlFor="stmt">
                Settlement total from the Paystack dashboard
              </label>
              <input
                id="stmt"
                value={settlementTotal}
                onChange={(e) => setSettlementTotal(e.target.value)}
                placeholder="Enter the settlement total"
                inputMode="decimal"
                autoComplete="off"
              />
            </div>

            <dl className="reconcile-rows">
              <div>
                <dt>Confirmed in this system</dt>
                <dd>{ghs(total)}</dd>
              </div>
              <div>
                <dt>Settled per Paystack</dt>
                <dd>{hasSettlement ? ghs(entered) : "—"}</dd>
              </div>
            </dl>

            {hasSettlement && (
              <div className={`variance ${reconciled ? "ok" : "bad"}`}>
                {reconciled ? (
                  <strong>These agree.</strong>
                ) : (
                  <>
                    <strong>
                      Off by {ghs(Math.abs(variance))}
                      {variance < 0
                        ? " — more confirmed here than settled"
                        : " — more settled than confirmed here"}
                    </strong>
                    <p>
                      {variance < 0
                        ? "A payment may be showing as confirmed before it's actually settled (Paystack settlement can lag the transaction), or a webhook wrote a duplicate/incorrect entry — check individual references against the Paystack dashboard."
                        : "Paystack settled a transaction that never wrote a confirmedPayments doc here — check for a missed or failed webhook."}
                    </p>
                  </>
                )}
              </div>
            )}

            <p className="reconcile-note">
              Nothing typed here is saved. It's a quick check against Paystack's
              dashboard total — the source of truth remains Paystack's own
              settlement report, not this figure.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
