import { BarChart, Donut } from "./miniCharts.jsx";
import { IconShield } from "./icons.jsx";

// metrics collection (4.6) — date, type, mode, outcome, doctorOrDept only.
// No patient name, phone, email or consultation ID is ever stored here.
export default function MetricsPanel({
  weeklyMetrics = [],
  outcomeBreakdown = [],
}) {
  const totalOpd = weeklyMetrics.reduce((s, d) => s + d.opd, 0);
  const totalSurgical = weeklyMetrics.reduce((s, d) => s + d.surgical, 0);
  const total = totalOpd + totalSurgical;
  const busiest =
    weeklyMetrics.length > 0
      ? weeklyMetrics.reduce((a, b) =>
          b.opd + b.surgical > a.opd + a.surgical ? b : a,
        )
      : null;

  return (
    <>
      <div className="admin-banner">
        <IconShield size={18} />
        <p>
          Built from consultation history. Patients' booking details are
          deleted when a consultation closes; history keeps only doctor,
          times, type, mode, outcome and amount.
        </p>
      </div>

      <div className="metrics-grid">
        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Consultation volume</h2>
              <p>This week, by day and type</p>
            </div>
            <div className="chart-legend">
              <span>
                <i style={{ background: "var(--color-primary)" }} />
                General OPD
              </span>
              <span>
                <i style={{ background: "var(--color-secondary)" }} />
                Surgical
              </span>
            </div>
          </div>
          <div className="admin-panel-body" style={{ padding: "18px 22px" }}>
            <BarChart data={weeklyMetrics} seriesA="opd" seriesB="surgical" />
          </div>
        </section>

        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Outcomes</h2>
              <p>How sessions ended</p>
            </div>
          </div>
          <div className="donut-wrap">
            <Donut data={outcomeBreakdown} />
            <ul className="donut-key">
              {outcomeBreakdown.map((o) => (
                <li key={o.label}>
                  <i style={{ background: o.color }} />
                  <span>{o.label}</span>
                  <strong>{o.value}</strong>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <h2>Week summary</h2>
            <p>Totals across all departments</p>
          </div>
        </div>
        <div className="summary-grid">
          <div>
            <span className="summary-value">{total}</span>
            <span className="summary-label">Consultations</span>
          </div>
          <div>
            <span className="summary-value">{totalOpd}</span>
            <span className="summary-label">General OPD</span>
          </div>
          <div>
            <span className="summary-value">{totalSurgical}</span>
            <span className="summary-label">Surgical</span>
          </div>
          <div>
            <span className="summary-value">{busiest ? busiest.day : "—"}</span>
            <span className="summary-label">Busiest day</span>
          </div>
        </div>
      </section>
    </>
  );
}
