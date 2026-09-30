import { useEffect, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../../context/authContext.jsx";
import HealthcarePreloader from "../../components/common/healthcarePreloader.jsx";
import AuthAside from "../../components/auth/authAside.jsx";
import {
  IconMail,
  IconLock,
  IconEye,
  IconEyeOff,
  IconAlert,
  IconCheckCircle,
  IconArrowLeft,
} from "../../components/auth/icons.jsx";
import "../../styles/auth.css";
import logo from "../../assets/logo.png";

const PATIENT_ASIDE_POINTS = [
  "Secured role-based access",
  "Every payment confirmation and schedule change is logged",
  "Encrypted video consultations",
];

const STAFF_ASIDE_POINTS = [
  "Authorized hospital staff only",
  "All sign-ins and actions are logged",
  "Sessions expire after a short idle period",
];

// Where each role lands after a successful sign-in.
const ROLE_HOME = {
  admin: "/admin",
  doctor: "/doctor",
  patient: "/dashboard",
};

// audience: "patient" (public /signin) or "staff" (hidden staff route).
// signIn() enforces it: an account whose role doesn't belong on this
// page is signed straight back out and gets the same generic error as
// a wrong password, so neither page reveals which kind of account exists.
export default function SignIn({ audience = "patient" }) {
  const isStaff = audience === "staff";
  const { signIn, resetPassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Keep the staff page out of search results.
  useEffect(() => {
    if (!isStaff) return;
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, [isStaff]);

  const resolveRedirect = (role) => {
    const roleHome = ROLE_HOME[role];
    if (!roleHome) return "/";

    const from = location.state?.from?.pathname;
    if (from && from.startsWith(roleHome)) return from;

    return roleHome;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setResetSent(false);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setSubmitting(true);
    try {
      const { role } = await signIn(email, password, {
        rememberMe: isStaff ? false : rememberMe,
        audience,
      });

      // MFA HOOK: once MFA is re-enabled for staff, catch
      // 'auth/multi-factor-auth-required' here and show a TOTP input.

      navigate(resolveRedirect(role), { replace: true });
    } catch (err) {
      setError(err.message || "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    setError("");
    setResetSent(false);
    if (!email.trim()) {
      setError('Enter your email above first, then click "Forgot password?".');
      return;
    }

    setResetting(true);
    try {
      // authContext.resetPassword already swallows "auth/user-not-found",
      // so an unknown email still reports success without revealing
      // which addresses have accounts. Any other failure (network,
      // invalid email, rate limiting, provider disabled) is thrown here.
      await resetPassword(email);
      setResetSent(true);
    } catch (err) {
      // The real Firebase code is on err.cause. Check the browser console
      // to see exactly why the reset failed.
      console.error("Password reset failed:", err.cause ?? err);
      setError(err.message || "Couldn't send the reset email. Try again.");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="auth-root">
      <AuthAside
        heading={isStaff ? "Staff sign-in" : "Sign in to your account"}
        body=""
        points={isStaff ? STAFF_ASIDE_POINTS : PATIENT_ASIDE_POINTS}
      />

      <div className="auth-formside">
        <div className="auth-card">
          {!isStaff && (
            <Link to="/" className="auth-back-link">
              <IconArrowLeft size={14} /> Back to home
            </Link>
          )}

          <div className="auth-mobile-brand">
            <div className="auth-aside-mark" style={{ width: 32, height: 32 }}>
              <img src={logo} alt="Holy Family Catholic Hospital logo" />
            </div>
            <div>
              <strong>Holy Family Catholic Hospital</strong>
              <small>
                {isStaff ? "Staff portal" : "Telemedicine Platform"}
              </small>
            </div>
          </div>

          <div className="auth-card-head">
            <h2>{isStaff ? "Staff sign-in" : "Welcome back"}</h2>
            <p>
              {isStaff
                ? "Authorized hospital staff only."
                : "Sign in to continue."}
            </p>
          </div>

          {error && (
            <div className="auth-alert">
              <IconAlert size={15} />
              <span>{error}</span>
            </div>
          )}
          {resetSent && !error && (
            <div className="auth-alert success">
              <IconCheckCircle size={15} />
              <span>
                If that email has an account, a reset link is on its way. Check
                your spam folder too.
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="auth-field">
              <label htmlFor="email">Email</label>
              <div className="auth-input-wrap">
                <IconMail size={15} />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="password">Password</label>
              <div className="auth-input-wrap">
                <IconLock size={15} />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="toggle-visibility"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <IconEyeOff size={15} />
                  ) : (
                    <IconEye size={15} />
                  )}
                </button>
              </div>
            </div>

            <div className="auth-row-between">
              {isStaff ? (
                <span />
              ) : (
                <label className="auth-remember">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  Remember me on this device
                </label>
              )}
              <button
                type="button"
                className="auth-forgot"
                onClick={handleForgotPassword}
                disabled={resetting}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--auth-secondary)",
                  cursor: resetting ? "default" : "pointer",
                  opacity: resetting ? 0.6 : 1,
                }}
              >
                {resetting ? "Sending..." : "Forgot password?"}
              </button>
            </div>

            <button type="submit" className="auth-submit" disabled={submitting}>
              {submitting ? (
                <HealthcarePreloader label="" size={18} />
              ) : (
                "Sign in"
              )}
            </button>
          </form>
          {!isStaff && (
            <p className="auth-switch">
              New patient? <Link to="/signup">Create an account</Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
