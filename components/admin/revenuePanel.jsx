import { useMemo, useState } from "react";
import { IconAlert } from "./icons.jsx";

// Revenue is a reconciliation view, not a fraud tripwire.
//
// Every figure here is derived from confirmations the admins themselves made,
// so a fraudulent confirmation raises the total and still reconciles with
// itself. The number only becomes a control when it is compared against the
// hospital's actual MoMo merchant statement — a source no admin can edit.
// That comparison is the box at the bottom of this panel.
//
// The per-admin breakdown is the useful part: it makes one person's confirmed
// total visible next to everyone else's.

const ghs = (n) =>
  `GHS ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const RANGES = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "all", label: "All time" },
];

export default function RevenuePanel({ payments }) {
  const [range, setRange] = useState("7");
  const [statementTotal, setStatementTotal] = useState("");

  const rows = useMemo(() => {
    if (range === "all") return payments;
    const days = parseInt(range, 10);
    const cutoff = Date.now() - days * 86400000;
    return payments.filter((p) => new Date(p.confirmedAt).getTime() >= cutoff);
  }, [payments, range]);

  const total = rows.reduce((s, p) => s + p.amount, 0);

  const byAdmin = useMemo(() => {
    const m = new Map();
    rows.forEach((p) => {
      const cur = m.get(p.confirmedBy) ?? { count: 0, amount: 0 };
      m.set(p.confirmedBy, {
        count: cur.count + 1,
        amount: cur.amount + p.amount,
      });
    });
    return [...m.entries()].sort((a, b) => b[1].amount - a[1].amount);
  }, [rows]);

  const byType = useMemo(() => {
    const m = new Map();
    rows.forEach((p) => {
      const cur = m.get(p.type) ?? { count: 0, amount: 0 };
      m.set(p.type, { count: cur.count + 1, amount: cur.amount + p.amount });
    });
    return [...m.entries()];
  }, [rows]);

  const entered = parseFloat(statementTotal.replace(/[^\d.]/g, ""));
  const hasStatement = Number.isFinite(entered);
  const variance = hasStatement ? entered - total : null;
  const reconciled = hasStatement && Math.abs(variance) < 0.01;

  return (
    <>
      <div className="admin-banner warn">
        <IconAlert size={18} />
        <p>
          These totals come from confirmations made in this system, so they
          agree with themselves by definition. Reconcile them against the
          hospital's MoMo merchant statement below — that is the only figure no
          account here can change.
        </p>
      </div>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <h2>Confirmed payments</h2>
            <p>Fees recorded against verified reference codes</p>
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
            <span className="summary-label">Expected total</span>
          </div>
          <div>
            <span className="summary-value">{rows.length}</span>
            <span className="summary-label">Payments confirmed</span>
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
              <h2>Confirmed by staff member</h2>
              <p>Who signed off on what, over the selected period</p>
            </div>
          </div>
          {byAdmin.length === 0 ? (
            <div className="admin-empty">
              No payments were confirmed in this period.
            </div>
          ) : (
            <div className="admin-panel-body">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Staff member</th>
                    <th>Payments</th>
                    <th>Total</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {byAdmin.map(([who, v]) => (
                    <tr key={who}>
                      <td className="admin-cell-name">{who}</td>
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
              <h2>Reconcile with MoMo</h2>
              <p>Compare against the merchant statement</p>
            </div>
          </div>
          <div className="reconcile-box">
            <div className="admin-field">
              <label htmlFor="stmt">
                Total received on the hospital MoMo line
              </label>
              <input
                id="stmt"
                value={statementTotal}
                onChange={(e) => setStatementTotal(e.target.value)}
                placeholder="Enter the statement total"
                inputMode="decimal"
                autoComplete="off"
              />
            </div>

            <dl className="reconcile-rows">
              <div>
                <dt>Expected from this system</dt>
                <dd>{ghs(total)}</dd>
              </div>
              <div>
                <dt>On the MoMo statement</dt>
                <dd>{hasStatement ? ghs(entered) : "—"}</dd>
              </div>
            </dl>

            {hasStatement && (
              <div className={`variance ${reconciled ? "ok" : "bad"}`}>
                {reconciled ? (
                  <strong>These agree.</strong>
                ) : (
                  <>
                    <strong>
                      Off by {ghs(Math.abs(variance))}
                      {variance < 0 ? " — more confirmed than received" : " — more received than confirmed"}
                    </strong>
                    <p>
                      {variance < 0
                        ? "Bookings were marked paid without a matching transfer. Check the audit log for confirmations in this period."
                        : "Some transfers arrived without a confirmed booking. Patients may have paid without submitting their reference code."}
                    </p>
                  </>
                )}
              </div>
            )}

            <p className="reconcile-note">
              Nothing typed here is saved. It is a calculator for whoever is
              doing the check, so the statement total never becomes another
              number an admin account controls.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
