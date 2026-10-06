// Unauthorized.jsx — shown when a signed-in user's role doesn't match
// the route's allowedRoles. Small helper page, referenced by protectedRoutes.jsx.

import { Link } from "react-router-dom";
import { IconAlert } from "../../components/auth/icons.jsx";
import "../../styles/auth.css";
import { usePageMeta } from "../../seo.js";

export default function Unauthorized() {
  usePageMeta({ title: "Not available", noindex: true });
  return (
    <div className="auth-root" style={{ gridTemplateColumns: "1fr" }}>
      <div className="auth-formside">
        <div className="auth-card" style={{ textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
            <div className="auth-aside-mark" style={{ background: "var(--auth-danger-bg)", border: "1px solid transparent" }}>
              <IconAlert size={18} />
            </div>
          </div>
          <div className="auth-card-head">
            <h2>You don't have access to this page</h2>
            <p>Your account doesn't have permission to view this section.</p>
          </div>
          <Link to="/" className="auth-submit" style={{ display: "inline-flex", textDecoration: "none" }}>
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
