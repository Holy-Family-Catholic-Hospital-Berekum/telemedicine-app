// AuthAside.jsx — the brand panel shown alongside the sign-in/sign-up
// form on wide screens. Static (never scrolls — see auth.css) so the
// logo and animation stay in view regardless of form length. Pulled
// out into its own component since signIn and signUp both use it with
// only the headline copy changing.

import { Link } from "react-router-dom";
import logo from "../../assets/logo.webp";
// Add your background photo at src/assets/auth-bg.webp (same folder as
// the logo). If you're using a different extension or filename, just
// update this import to match.

import authDefault from "../../assets/auth-bg.webp";
import { useSiteSettings } from "../../siteSettings";

export default function AuthAside({ heading, body, points }) {
  const { settings } = useSiteSettings();
  const bgPhoto = settings.authImage ?? authDefault;
  return (
    <aside className="auth-aside">
      <div
        className="auth-aside-photo"
        style={{ backgroundImage: `url(${bgPhoto})` }}
        aria-hidden="true"
      />

      <Link to="/" className="auth-aside-brand" aria-label="Back to home">
        <div className="auth-aside-mark">
          <img src={logo} alt="Holy Family Catholic Hospital logo" />
        </div>
        <div>
          <strong>Holy Family Catholic Hospital</strong>
          <small>Telemedicine Platform</small>
        </div>
      </Link>

      <div className="auth-aside-copy">
        <h1>{heading}</h1>
        <p>{body}</p>

        <div className="auth-aside-points">
          {points.map((pt) => (
            <div className="auth-aside-point" key={pt}>
              <span className="dot">✓</span>
              <span>{pt}</span>
            </div>
          ))}
        </div>
      </div>

      <svg
        className="auth-aside-ecg"
        viewBox="0 0 400 120"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="asideEcgGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="50%" stopColor="#FFD9B8" />
            <stop offset="100%" stopColor="#BEEAFC" />
          </linearGradient>
        </defs>
        <path
          d="M0 60 H120 L135 20 L160 100 L180 40 L195 60 H400"
          fill="none"
          stroke="url(#asideEcgGrad)"
          strokeWidth="2.5"
        />
      </svg>

      <div className="auth-aside-footer">
        Data is encrypted in transit. Booking details are deleted when your consultation closes.
      </div>
    </aside>
  );
}
