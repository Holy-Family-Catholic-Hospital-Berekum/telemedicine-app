import {
  IconOverview,
  IconCalendar,
  IconCard,
  IconClock,
  IconTag,
  IconPulse,
  IconShield,
  IconChart,
  IconLogout,
} from "./icons.jsx";

import logo from "./logo.png";
const NAV_ITEMS = [
  { key: "overview", label: "Overview", icon: IconOverview },
  { key: "bookings", label: "Scheduling", icon: IconCalendar },
  { key: "payments", label: "New Bookings", icon: IconCard },
  { key: "history", label: "Consultation History", icon: IconClock },
  { key: "revenue", label: "Revenue", icon: IconTag },
  { key: "activity", label: "Activity", icon: IconPulse },
  { key: "audit", label: "Audit Log", icon: IconShield },
  { key: "metrics", label: "Metrics & Reports", icon: IconChart },
];

export default function Sidebar({
  active,
  onChange,
  admin,
  pendingCount,
  onLogout,
}) {
  return (
    <aside className="admin-sidebar">
      <div className="admin-brand">
        <div className="admin-brand-mark">
          <img src={logo} alt="logo" className="w-12 h-10" />
        </div>
        <div className="admin-brand-text">
          <strong>Holy Family Hospital</strong>
          <small>Telemedicine · Admin Console</small>
        </div>
      </div>

      <nav className="admin-nav">
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`admin-nav-item${active === key ? " active" : ""}`}
            onClick={() => onChange(key)}
          >
            <Icon size={17} />
            {label}
            {key === "payments" && pendingCount > 0 && (
              <span className="admin-nav-badge">{pendingCount}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="admin-sidebar-footer">
        <div className="admin-avatar">{admin.initials}</div>
        <div className="who">
          <strong>{admin.name}</strong>
          <small>{admin.role} · MFA verified</small>
        </div>
        <button onClick={onLogout} title="Log out" aria-label="Log out">
          <IconLogout size={17} />
        </button>
      </div>
    </aside>
  );
}
