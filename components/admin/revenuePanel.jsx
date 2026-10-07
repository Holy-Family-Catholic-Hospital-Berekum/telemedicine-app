import { useEffect, useMemo, useState } from "react";
import {
  Timestamp,
  collection,
  count,
  getAggregateFromServer,
  orderBy,
  query,
  sum,
  where,
} from "firebase/firestore";
import { db } from "../../src/firebase";
import { useFirestoreCollection } from "./hooks/useFirestoreCollection.js";
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
// - Field is `paidAt`.
//
// SCALE: this panel never downloads every payment ever made. A period
// (7 / 30 / 90 days) loads only that period's payments; "All time" asks
// Firestore for the totals (sum and count, overall and per type) without
// downloading the payments themselves, so it costs the same at any size.

const ghs = (n) =>
  `GHS ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const RANGES = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
  { key: "all", label: "All time" },
];
const TYPES = ["OPD", "SURGICAL", "NO_SHOW_FEE"];
const TYPE_NAME = { OPD: "General OPD", SURGICAL: "Surgical", NO_SHOW_FEE: "No-show fees" };

// Refunds (refundRequests: patients' requests; paymentIssues: payments we
// couldn't use, refunded automatically). A refund counts as done when its
// status is "refunded"; refundedAt / amountRefunded are set by the server
// for Paystack and manual refunds alike.
const REFUND_SOURCES = [
  { col: "refundRequests", inProgress: ["refund_starting", "processing"], waiting: ["requested", "failed"], waitingAmount: "suggestedRefund" },
  { col: "paymentIssues", inProgress: ["refund_starting", "refund_processing"], waiting: ["refund_due", "refund_failed"], waitingAmount: "amount" },
];
const refundAmount = (r) => Number(r.amountRefunded ?? r.amount ?? 0);

/** All-time refunded totals (Firestore aggregation, nothing downloaded). */
function useAllTimeRefunds(enabled) {
  const [totals, setTotals] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    Promise.all(
      REFUND_SOURCES.map((s) =>
        getAggregateFromServer(
          query(collection(db, s.col), where("status", "==", "refunded")),
          { amount: sum("amountRefunded"), count: count() },
        ),
      ),
    )
      .then((parts) => {
        if (!active) return;
        setTotals({
          amount: parts.reduce((t, p) => t + (p.data().amount || 0), 0),
          count: parts.reduce((t, p) => t + (p.data().count || 0), 0),
        });
      })
      .catch(() => active && setTotals({ error: true }));
    return () => {
      active = false;
    };
  }, [enabled]);
  return totals;
}

/** Refund figures for the chosen period, plus what is open right now. */
function RefundsSection({ allTime, since, confirmedTotal }) {
  const periodQueries = useMemo(
    () =>
      REFUND_SOURCES.map((s) =>
        allTime
          ? null
          : query(
              collection(db, s.col),
              where("status", "==", "refunded"),
              where("refundedAt", ">=", Timestamp.fromMillis(since)),
            ),
      ),
    [allTime, since],
  );
  const openQueries = useMemo(
    () =>
      REFUND_SOURCES.map((s) =>
        query(collection(db, s.col), where("status", "in", [...s.inProgress, ...s.waiting])),
      ),
    [],
  );
  const { data: periodRequests } = useFirestoreCollection(periodQueries[0]);
  const { data: periodIssues } = useFirestoreCollection(periodQueries[1]);
  const { data: openRequests } = useFirestoreCollection(openQueries[0]);
  const { data: openIssues } = useFirestoreCollection(openQueries[1]);
  const allTimeTotals = useAllTimeRefunds(allTime);

  const refunded = allTime
    ? { amount: allTimeTotals?.amount ?? 0, count: allTimeTotals?.count ?? 0 }
    : {
        amount: [...periodRequests, ...periodIssues].reduce((t, r) => t + refundAmount(r), 0),
        count: periodRequests.length + periodIssues.length,
      };

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
      {allTime && allTimeTotals?.error && (
        <div className="admin-empty" role="alert">
          Couldn't load the all-time refund totals. Refresh the page or pick a period.
        </div>
      )}
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

/** All-time totals computed by Firestore (no documents downloaded). */
function useAllTimeTotals(enabled) {
  const [totals, setTotals] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const col = collection(db, "confirmedPayments");
    const agg = (q) => getAggregateFromServer(q, { amount: sum("amount"), count: count() });
    Promise.all([
      getAggregateFromServer(col, { amount: sum("amount"), fees: sum("fees"), count: count() }),
      ...TYPES.map((t) => agg(query(col, where("type", "==", t)))),
    ])
      .then(([all, ...perType]) => {
        if (!active) return;
        setTotals({
          total: all.data().amount || 0,
          fees: all.data().fees || 0,
          count: all.data().count || 0,
          byType: TYPES.map((t, i) => [t, { amount: perType[i].data().amount || 0, count: perType[i].data().count || 0 }])
            .filter(([, v]) => v.count > 0),
        });
      })
      .catch(() => active && setTotals({ error: true }));
    return () => {
      active = false;
    };
  }, [enabled]);
  return totals;
}

export default function RevenuePanel() {
  const [range, setRange] = useState("7");
  const [settlementTotal, setSettlementTotal] = useState("");
  // When the tab was opened: the "last N days" window is relative to it.
  const [openedAt] = useState(() => Date.now());
  const allTime = range === "all";

  // A period: only that period's payments are loaded.
  const periodQuery = useMemo(
    () =>
      allTime
        ? null
        : query(
          collection(db, "confirmedPayments"),
          where("paidAt", ">=", Timestamp.fromMillis(openedAt - parseInt(range, 10) * 86400000)),
          orderBy("paidAt", "desc"),
        ),
    [allTime, range, openedAt],
  );
  const { data: rows } = useFirestoreCollection(periodQuery);
  const totals = useAllTimeTotals(allTime);

  const total = allTime ? (totals?.total ?? 0) : rows.reduce((s, p) => s + p.amount, 0);
  // Paystack's charges (recorded per payment from Paystack's own data);
  // net is what reaches the hospital's Paystack settlement.
  const fees = allTime ? (totals?.fees ?? 0) : rows.reduce((s, p) => s + Number(p.fees || 0), 0);
  const net = total - fees;
  const paymentCount = allTime ? (totals?.count ?? 0) : rows.length;

  const byType = useMemo(() => {
    if (allTime) return totals?.byType ?? [];
    const m = new Map();
    rows.forEach((p) => {
      const cur = m.get(p.type) ?? { count: 0, amount: 0 };
      m.set(p.type, { count: cur.count + 1, amount: cur.amount + p.amount });
    });
    return [...m.entries()];
  }, [rows, allTime, totals]);

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

        {allTime && totals?.error && (
          <div className="admin-empty" role="alert">
            Couldn't load the all-time totals. Refresh the page or pick a period.
          </div>
        )}
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

      <RefundsSection
        allTime={allTime}
        since={allTime ? 0 : openedAt - parseInt(range, 10) * 86400000}
        confirmedTotal={total}
      />

      <div className="metrics-grid">
        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>By payment channel</h2>
              <p>Card, mobile money, etc. — over the selected period</p>
            </div>
          </div>
          {allTime ? (
            <div className="admin-empty">
              Choose a period to see the breakdown by channel.
            </div>
          ) : byChannel.length === 0 ? (
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
