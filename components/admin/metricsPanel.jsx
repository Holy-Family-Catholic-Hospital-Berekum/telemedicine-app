import { BarChart, Donut } from "./miniCharts.jsx";
import { IconShield } from "./icons.jsx";
import MetricsExport from "./metricsExport.jsx";
import RefreshRow from "./refreshRow.jsx";
import { useConsultationStats } from "./hooks/useServerTotals.js";

// metrics collection (4.6) — date, type, mode, outcome, doctorOrDept only.
// No patient name, phone, email or consultation ID is ever stored here.
export default function MetricsPanel() {
  // Counted by the database over all history, not just what's loaded.
  const consultationStats = useConsultationStats();
  const weeklyMetrics = consultationStats.data?.weekly ?? [];
  const outcomeBreakdown = consultationStats.data?.outcomes ?? [];
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
          Counted by the database from consultation history (press Refresh
          for the latest). Patients' booking details are
          deleted when a consultation closes; history keeps only doctor,
          times, type, mode, outcome and amount.
        </p>
      </div>

      <MetricsExport />

      <RefreshRow totals={consultationStats} what="the consultation figures" />

      <div className="metrics-grid">
        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Consultation volume</h2>
              <p>Last 7 days, by day and type</p>
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
              <p>How consultations ended, all time</p>
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
            <h2>Last 7 days</h2>
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
