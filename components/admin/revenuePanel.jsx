import { useMemo, useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { db } from "../../src/firebase";
import { useFirestoreCollection } from "./hooks/useFirestoreCollection.js";
import { useRevenueTotals } from "./hooks/useServerTotals.js";
import RefreshRow from "./refreshRow.jsx";
import { IconInfo } from "./icons.jsx";

// Revenue: a reporting view of what Paystack has confirmed paid, and a
// check against Paystack's own settlement total (from the Paystack
// dashboard), the one figure that comes from outside this system.
//
// Payments are confirmed only by the server (signed Paystack webhook or
// verify-by-reference, functions/payments.js); no admin action creates or
// changes a `confirmedPayments` record. Each one holds amount, Paystack's
// charge (`fees`), type, `channel` (mobile_money, card, ...; payments with
// another or no channel show as "Other"), reference and `paidAt`.
//
// SCALE: this panel never downloads payments. Every figure, for a period
// or all time, is a Firestore count/sum (hooks/useServerTotals.js), so it
// costs the same at any size. Loaded when the tab opens and on Refresh.

const ghs = (n) =>
  `GHS ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const RANGES = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
  { key: "all", label: "All time" },
];
const TYPE_NAME = {
  OPD: "General OPD",
  SURGICAL: "Surgical",
  NO_SHOW_FEE: "No-show fees",
  RESCHEDULE_FEE: "Late reschedule fees",
};

// Refunds (refundRequests: patients' requests; paymentIssues: payments we
// couldn't use, refunded automatically). A refund counts as done when its
// status is "refunded"; refundedAt / amountRefunded are set by the server
// for Paystack and manual refunds alike.
const REFUND_SOURCES = [
  { col: "refundRequests", inProgress: ["refund_starting", "processing"], waiting: ["requested", "failed"], waitingAmount: "suggestedRefund" },
  { col: "paymentIssues", inProgress: ["refund_starting", "refund_processing"], waiting: ["refund_due", "refund_failed"], waitingAmount: "amount" },
];

/** Refund figures for the chosen period, plus what is open right now. */
function RefundsSection({ refunded, confirmedTotal }) {
  // Refunds open right now: a short list admins act on, kept live.
  const openQueries = useMemo(
    () =>
      REFUND_SOURCES.map((s) =>
        query(collection(db, s.col), where("status", "in", [...s.inProgress, ...s.waiting])),
      ),
    [],
  );
  const { data: openRequests } = useFirestoreCollection(openQueries[0]);
  const { data: openIssues } = useFirestoreCollection(openQueries[1]);

  const tally = (rows, source, which) =>
    rows
      .filter((r) => source[which].includes(r.status))
      .reduce(
        (t, r) => ({
          count: t.count + 1,
          amount: t.amount + Number((which === "waiting" ? r[source.waitingAmount] : r.amountRefunded ?? r.amount) ?? 0),
        }),
        { count: 0, amount: 0 },
      );
  const add = (a, b) => ({ count: a.count + b.count, amount: a.amount + b.amount });
  const inProgress = add(
    tally(openRequests, REFUND_SOURCES[0], "inProgress"),
    tally(openIssues, REFUND_SOURCES[1], "inProgress"),
  );
  const waiting = add(
    tally(openRequests, REFUND_SOURCES[0], "waiting"),
    tally(openIssues, REFUND_SOURCES[1], "waiting"),
  );

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <div>
          <h2>Refunds</h2>
          <p>
            Refunded in the selected period, and refunds open right now
            (patients' requests and payments refunded automatically)
          </p>
        </div>
      </div>
      <div className="summary-grid">
        <div>
          <span className="summary-value">{ghs(refunded.amount)}</span>
          <span className="summary-label">Refunded · {refunded.count}</span>
        </div>
        <div>
          <span className="summary-value">{ghs(Math.max(0, confirmedTotal - refunded.amount))}</span>
          <span className="summary-label">Net after refunds</span>
        </div>
        <div>
          <span className="summary-value">{ghs(inProgress.amount)}</span>
          <span className="summary-label">Being refunded now · {inProgress.count}</span>
        </div>
        <div>
          <span className="summary-value">{ghs(waiting.amount)}</span>
          <span className="summary-label">Waiting for an admin · {waiting.count}</span>
        </div>
      </div>
    </section>
  );
}

export default function RevenuePanel() {
  const [range, setRange] = useState("7");
  const [settlementTotal, setSettlementTotal] = useState("");
  // When the tab was opened: the "last N days" window is relative to it.
  const [openedAt] = useState(() => Date.now());
  const allTime = range === "all";

  const since = allTime ? null : openedAt - parseInt(range, 10) * 86400000;
  const totals = useRevenueTotals(since);
  const t = totals.data;
  const total = t?.total ?? 0;
  // Paystack's charges (recorded per payment from Paystack's own data);
  // net is what reaches the hospital's Paystack settlement.
  const fees = t?.fees ?? 0;
  const net = total - fees;
  const paymentCount = t?.count ?? 0;
  const byType = t?.byType ?? [];
  const byChannel = t?.byChannel ?? [];

  const entered = parseFloat(settlementTotal.replace(/[^\d.]/g, ""));
  const hasSettlement = Number.isFinite(entered);
  // Paystack settles the amount after its charges.
  const variance = hasSettlement ? entered - net : null;
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

        <RefreshRow totals={totals} what="the totals" />
        <div className="summary-grid">
          <div>
            <span className="summary-value">{ghs(total)}</span>
            <span className="summary-label">Total confirmed</span>
          </div>
          <div>
            <span className="summary-value">{ghs(fees)}</span>
            <span className="summary-label">Paystack charges</span>
          </div>
          <div>
            <span className="summary-value">{ghs(net)}</span>
            <span className="summary-label">Received after charges</span>
          </div>
          <div>
            <span className="summary-value">{paymentCount}</span>
            <span className="summary-label">Payments</span>
          </div>
          {byType.map(([type, v]) => (
            <div key={type}>
              <span className="summary-value">{ghs(v.amount)}</span>
              <span className="summary-label">
                {TYPE_NAME[type] ?? type} · {v.count}
              </span>
            </div>
          ))}
        </div>
      </section>

      <RefundsSection refunded={t?.refunded ?? { amount: 0, count: 0 }} confirmedTotal={total} />

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
                <dt>Received after Paystack charges (this system)</dt>
                <dd>{ghs(net)}</dd>
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
