import StatCard from "./statCard.jsx";
import { BarChart } from "./miniCharts.jsx";
import {
  IconCalendar,
  IconPulse,
  IconShield,
  IconAlert,
  IconCheck,
  IconX,
} from "./icons.jsx";

const activityIcon = {
  confirmed: IconCheck,
  rejected: IconX,
  blocked_duplicate: IconAlert,
};
const activityTint = {
  confirmed: { bg: "var(--color-success-bg)", fg: "var(--color-success)" },
  rejected: { bg: "var(--color-danger-bg)", fg: "var(--color-danger)" },
  blocked_duplicate: {
    bg: "var(--color-warning-bg)",
    fg: "var(--color-warning)",
  },
};
const activityText = {
  confirmed: (a) => `${a.account} confirmed payment for ${a.referenceCode}`,
  rejected: (a) => `${a.account} rejected reference ${a.referenceCode}`,
  blocked_duplicate: (a) =>
    `Blocked reuse attempt on ${a.referenceCode} by ${a.account}`,
};

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
              <p>Reference-ledger events</p>
            </div>
          </div>
          <div className="activity-list">
            {recentActivity.length === 0 ? (
              <div className="admin-empty">No recent activity yet.</div>
            ) : (
              recentActivity.slice(0, 4).map((a) => {
                const Icon = activityIcon[a.type];
                const tint = activityTint[a.type];
                if (!Icon || !tint) return null; // unknown event type — skip rather than crash
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
                        {activityText[a.type](a)}
                      </div>
                      <div className="activity-meta">
                        {new Date(a.timestamp).toLocaleString()}
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
