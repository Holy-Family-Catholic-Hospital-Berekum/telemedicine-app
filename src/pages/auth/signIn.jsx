import { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../../context/authContext.jsx";
import HealthcarePreloader from "../../components/common/healthcarePreloader.jsx";
import AuthAside from "../../components/auth/authAside.jsx";
import StaffSecondFactor from "./staffSecondFactor.jsx";
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
import { usePageMeta } from "../../seo.js";

const PATIENT_ASIDE_POINTS = [
    "See and join your appointments",
  "Change your appointment time",
  "Your information is kept private",
];

const STAFF_ASIDE_POINTS = [
  "Authorized hospital staff only",
  "Two-step sign-in for every staff account",
  "All sign-ins and actions are logged",
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
  // Staff second step: { kind: "totp" | "totp_enroll" | "email_code", ... }
  const [staffStep, setStaffStep] = useState(null);
  const [enrolledNote, setEnrolledNote] = useState(false);

  // The staff page is kept out of search results (noindex) and has no
  // canonical address, so its hidden path is never published.
  usePageMeta(
    isStaff
      ? { title: "Staff sign-in", noindex: true }
      : {
          title: "Sign In",
          description:
            "Sign in to book, join or reschedule your consultation with Holy Family Catholic Hospital, Berekum.",
          path: "/signin",
        },
  );

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
      const result = await signIn(email, password, {
        rememberMe: isStaff ? false : rememberMe,
        audience,
      });
      if (result.step) {
        setEnrolledNote(false);
        setPassword("");
        setStaffStep({ ...result, kind: result.step });
        return;
      }
      navigate(resolveRedirect(result.role), { replace: true });
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
                {isStaff ? "Staff portal" : "Berekum, Ghana"}
              </small>
            </div>
          </div>

          <div className="auth-card-head">
            <h2>{isStaff ? "Staff sign-in" : "Welcome back"}</h2>
            <p>
              {isStaff
                ? "Authorized hospital staff only."
                                  : "Sign in with the email and password you signed up with."}
            </p>
          </div>

          {staffStep ? (
            <StaffSecondFactor
              step={staffStep}
              onSignedIn={({ role }) => {
                // Only a fully signed-in staff account (with a role) leaves
                // this page; anything else stays on the sign-in steps.
                if (role) navigate(resolveRedirect(role), { replace: true });
              }}
              onStep={(next) => setStaffStep(next)}
              onDone={(outcome) => {
                setStaffStep(null);
                setEnrolledNote(outcome === "enrolled");
              }}
            />
          ) : (
          <>
          {enrolledNote && (
            <div className="auth-alert success" role="status">
              <IconCheckCircle size={15} />
              <span>
                Your authenticator is set up. Sign in again: you'll be asked
                for its code, then once for your setup code.
              </span>
            </div>
          )}
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
              No account yet? <Link to="/signup">Create one here</Link>
            </p>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
