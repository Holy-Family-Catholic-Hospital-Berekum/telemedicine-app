import StatCard from "./statCard.jsx";
import { BarChart } from "./miniCharts.jsx";
import {
  IconCalendar,
  IconPulse,
  IconShield,
  IconAlert,
  IconCheck,
} from "./icons.jsx";

// Recent audit-log entries. Failed/denied ones (flagged payments, missing
// recordings, bad webhook signatures) stand out.
function tintFor(entry) {
  return entry.result && entry.result !== "success"
    ? { Icon: IconAlert, bg: "var(--color-warning-bg)", fg: "var(--color-warning)" }
    : { Icon: IconCheck, bg: "var(--color-success-bg)", fg: "var(--color-success)" };
}

// Payments are confirmed automatically by Paystack — there is no manual
// "awaiting verification" step for admin, so that stat card (and the
// old manual-MoMo-confirmation flow it implied) has been removed.
export default function OverviewPanel({
  stats,
  weeklyMetrics = [],
  recentActivity = [],
}) {
  return (
    <>
      <div className="admin-stat-grid">
        <StatCard
          icon={IconCalendar}
          tint="secondary"
          value={stats.todaysBookings}
          label="Bookings today"
          delay={0}
        />
        <StatCard
          icon={IconPulse}
          tint="success"
          value={stats.activeConsultations}
          label="Consultations in progress"
          delay={60}
        />
        <StatCard
          icon={IconShield}
          tint="warning"
          value={stats.doctorsOnDuty}
          label="Doctors on duty"
          delay={120}
        />
      </div>
      <div className="metrics-grid">
        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>This week's consultation volume</h2>
              <p>General OPD vs. Surgical, by day</p>
            </div>
            <div className="chart-legend">
              <span>
                <i style={{ background: "var(--color-primary)" }} />
                OPD
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
              <h2>Recent activity</h2>
              <p>Latest entries from the audit log</p>
            </div>
          </div>
          <div className="activity-list">
            {recentActivity.length === 0 ? (
              <div className="admin-empty">No recent activity yet.</div>
            ) : (
              recentActivity.slice(0, 6).map((a) => {
                const { Icon, ...tint } = tintFor(a);
                return (
                  <div className="activity-row" key={a.id}>
                    <div
                      className="activity-icon"
                      style={{ background: tint.bg, color: tint.fg }}
                    >
                      <Icon size={14} />
                    </div>
                    <div>
                      <div className="activity-text">
                        {a.action}
                      </div>
                      <div className="activity-meta">
                        {a.timestamp ? new Date(a.timestamp).toLocaleString() : "Just now"}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </>
  );
}
