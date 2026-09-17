export default function StatCard({ icon: Icon, value, label, tint = "primary", delay = 0 }) {
  const tints = {
    primary: { bg: "var(--color-surface-alt)", fg: "var(--color-primary)" },
    secondary: { bg: "#E7F4FB", fg: "var(--color-secondary)" },
    success: { bg: "var(--color-success-bg)", fg: "var(--color-success)" },
    warning: { bg: "var(--color-warning-bg)", fg: "var(--color-warning)" },
  };
  const t = tints[tint] || tints.primary;

  return (
    <div className="admin-stat-card" style={{ animationDelay: `${delay}ms` }}>
      <div className="icon-wrap" style={{ background: t.bg, color: t.fg }}>
        <Icon size={17} />
      </div>
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}