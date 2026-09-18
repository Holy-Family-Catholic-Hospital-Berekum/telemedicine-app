// signIn.jsx
//
// One shared sign-in form for patients, admins and doctors — role is
// resolved server-side (via authContext, from Firestore) after a
// successful password auth, and we redirect based on it. There is no
// role picker on this screen on purpose: letting a user *claim* a role
// in the UI would be meaningless (and a red flag) since the real check
// happens against adminUsers/users in Firestore.
//
// MFA is intentionally disabled for now — see the "MFA HOOK" comment
// below for exactly where a TOTP challenge step would go once you turn
// it back on for staff accounts.

import { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../../context/authContext.jsx";
import HealthcarePreloader from "../../components/common/HealthcarePreloader.jsx";
import AuthAside from "../../components/auth/AuthAside.jsx";
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

const ASIDE_POINTS = [
  "Role-based access for patients, doctors and admin staff",
  "Every payment confirmation and schedule change is logged",
  "Encrypted video consultations, no call recordings",
];

export default function SignIn() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [resetSent, setResetSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setSubmitting(true);
    try {
      await signIn(email, password, { rememberMe });

      // MFA HOOK: once MFA is re-enabled for staff, signIn() above will
      // throw for accounts with mfaEnabled and you'll catch
      // 'auth/multi-factor-auth-required' here, show a TOTP code input,
      // and call resolver.resolveSignIn(...) before navigating on.

      // authContext resolves role from Firestore on the auth-state
      // listener; give it a tick, then let ProtectedRoute/redirect
      // logic upstream route by role. Simplest: send everyone to a
      // neutral "/" that your router redirects by role, or read role
      // straight from context in a useEffect. Here we just go back to
      // wherever the user was headed, or a default landing route.
      const dest = location.state?.from?.pathname || "/";
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err.message || "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const { resetPassword } = useAuth();
  const handleForgotPassword = async () => {
    setError("");
    if (!email.trim()) {
      setError('Enter your email above first, then click "Forgot password?".');
      return;
    }
    try {
      await resetPassword(email);
      setResetSent(true);
    } catch {
      setResetSent(true); // still show generic success — see resetPassword() note
    }
  };

  return (
    <div className="auth-root">
      <AuthAside
        heading="Sign in to your account"
        body="Patients, doctors and hospital staff all sign in here — you'll land on the right dashboard for your role."
        points={ASIDE_POINTS}
      />

      <div className="auth-formside">
        <div className="auth-card">
          <Link to="/" className="auth-back-link">
            <IconArrowLeft size={14} /> Back to home
          </Link>

          <div className="auth-mobile-brand">
            <div className="auth-aside-mark" style={{ width: 32, height: 32 }}>
              <img src={logo} alt="Holy Family Catholic Hospital logo" />
            </div>
            <div>
              <strong>Holy Family Catholic Hospital</strong>
              <small>Telemedicine Platform</small>
            </div>
          </div>

          <div className="auth-card-head">
            <h2>Welcome back</h2>
            <p>Sign in to continue.</p>
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
                If that email has an account, a reset link is on its way.
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
              <label className="auth-remember">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                Remember me on this device
              </label>
              <button
                type="button"
                className="auth-forgot"
                onClick={handleForgotPassword}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--auth-secondary)",
                  cursor: "pointer",
                }}
              >
                Forgot password?
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

          <p className="auth-switch">
            New patient? <Link to="/signup">Create an account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
