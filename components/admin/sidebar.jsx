import {
  IconOverview,
  IconCalendar,
  IconClock,
  IconTag,
  IconPulse,
  IconShield,
  IconChart,
  IconUsers, // ASSUMPTION: swap for whatever icon your icons.jsx actually exports for this
  IconSettings, // NEW — used for the Control Panel tab, added to icons.jsx.
  IconUserCheck,
  IconLogout,
} from "./icons.jsx";

import logo from "./logo.png";

const NAV_ITEMS = [
  { key: "overview", label: "Overview", icon: IconOverview },
  { key: "bookings", label: "New Bookings", icon: IconCalendar },
  { key: "history", label: "Consultation History", icon: IconClock },
  { key: "users", label: "Users", icon: IconUsers },
  { key: "recordings", label: "Call Recordings", icon: IconPulse },
  { key: "revenue", label: "Revenue", icon: IconTag },
  { key: "audit", label: "Audit Log", icon: IconShield },
  { key: "metrics", label: "Metrics & Reports", icon: IconChart },
  // NEW — site content admins can change without a code deploy: home page
  // photo, consultation prices, BrandAside slideshow, sign-in/sign-up photo.
  { key: "control", label: "Control Panel", icon: IconSettings },
  // The signed-in admin's own name and sign-in email.
  { key: "account", label: "My Account", icon: IconUserCheck },
];

export default function Sidebar({
  active,
  onChange,
  admin,
  badges = {},
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
            {/* bookings: paid bookings to schedule; revenue: refunds to handle */}
            {badges[key] > 0 && (
              <span
                className="admin-nav-badge"
                title={key === "revenue" ? "Refunds waiting for an admin" : "Bookings to schedule"}
              >
                {badges[key]}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="admin-sidebar-footer">
        <div className="admin-avatar">{admin.initials}</div>
        <div className="who">
          <strong>{admin.name}</strong>
          <small>{admin.role}</small>
        </div>
        <button onClick={onLogout} title="Log out" aria-label="Log out">
          <IconLogout size={17} />
        </button>
      </div>
    </aside>
  );
}
