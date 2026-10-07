// signUp.jsx
//
// Patient self-service sign-up only. Per the architecture doc (4.1),
// admin and doctor accounts are created manually by the hospital, not
// through a public form — so this page never offers a role choice.
//
// After account creation we send a verification email and route to
// /verify-email; per 6.2, a patient can't create a booking until that
// email is verified. ProtectedRoute enforces that server-side-checked
// gate on booking routes (see protectedRoutes.jsx).
//
// Accounts are for adults. Following Ghana's Data Protection Act, 2012
// (Act 843), a child's data is processed only with a parent's or guardian's
// consent, so the sign-up asks for a separate, specific declaration that
// the person is 18 or older (versioned text in src/consentText.js, stored
// by registerPatient). Children are booked by a parent or guardian, who
// consents for them on the booking form. We don't ask for a date of birth
// here: the declaration is all an account needs (data minimisation).

import { useState, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../context/authContext.jsx";
import { AGE_DECLARATION_TEXT } from "../../consentText.js";
import HealthcarePreloader from "../../components/common/healthcarePreloader.jsx";
import AuthAside from "../../components/auth/authAside.jsx";
import {
  IconMail,
  IconLock,
  IconUser,
  IconPhone,
  IconEye,
  IconEyeOff,
  IconAlert,
  IconArrowLeft,
} from "../../components/auth/icons.jsx";
import {
  isValidEmail,
  isValidPhone,
  isValidName,
  passwordIssues,
  passwordStrengthLabel,
} from "../../utils/validators.js";
import "../../styles/auth.css";
import logo from "../../assets/logo.png";
import { usePageMeta } from "../../seo.js";

const ASIDE_POINTS = [
  "Book General OPD or Surgical, by video call or at the hospital",
  "Pay with mobile money (MoMo)",
  "Your booking details are deleted after your visit",
];

export default function SignUp() {
  usePageMeta({
    title: "Create an Account",
    description:
      "Create a free account to book online or in-person consultations with Holy Family Catholic Hospital doctors in Berekum, Ghana.",
    path: "/signup",
  });
  const { signUpPatient } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [adultChecked, setAdultChecked] = useState(false);

  const update = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const pwIssues = useMemo(
    () => passwordIssues(form.password),
    [form.password],
  );
  const pwStrength = useMemo(
    () => passwordStrengthLabel(form.password),
    [form.password],
  );

  const validate = () => {
    const errs = {};
    if (!isValidName(form.name)) errs.name = "Enter your full name.";
    if (!isValidPhone(form.phone))
      errs.phone = "Enter a valid phone number (e.g. 024xxxxxxx).";
    if (!isValidEmail(form.email)) errs.email = "Enter a valid email address.";
    if (pwIssues.length > 0)
      errs.password = "Password doesn't meet the requirements below.";
    if (form.confirm !== form.password) errs.confirm = "Passwords don't match.";
    if (!adultChecked)
      errs.adult =
        "You must be 18 or older to create an account. A parent or guardian can book for a child from their own account.";
    if (!consentChecked)
      errs.consent =
        "Please agree to the Terms of Service and Privacy Policy to continue.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!validate()) return;

    setSubmitting(true);
    try {
      await signUpPatient({
        name: form.name,
        phone: form.phone,
        email: form.email,
        password: form.password,
        acceptedTerms: consentChecked,
        confirmedAdult: adultChecked,
      });
      navigate("/verify-email", { replace: true });
    } catch (err) {
      setError(
        err.message || "Couldn't create your account. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-root">
      <AuthAside
        heading="Your health, our priority"
        body="Sign up to book a consultation with Holy Family Catholic Hospital's telemedicine service."
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
              <small>Berekum, Ghana</small>
            </div>
          </div>

          <div className="auth-card-head">
            <h2>Create your account</h2>
          </div>

          {error && (
            <div className="auth-alert">
              <IconAlert size={15} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="auth-field">
              <label htmlFor="name">Full name</label>
              <div
                className={`auth-input-wrap${fieldErrors.name ? " error" : ""}`}
              >
                <IconUser size={15} />
                <input
                  id="name"
                  autoComplete="name"
                  placeholder="Ama Serwaa"
                  value={form.name}
                  onChange={update("name")}
                />
              </div>
              {fieldErrors.name && (
                <div className="auth-field-error">{fieldErrors.name}</div>
              )}
            </div>

            <div className="auth-field">
              <label htmlFor="phone">Phone number</label>
              <div
                className={`auth-input-wrap${fieldErrors.phone ? " error" : ""}`}
              >
                <IconPhone size={15} />
                <input
                  id="phone"
                  autoComplete="tel"
                  placeholder="024 000 0000"
                  value={form.phone}
                  onChange={update("phone")}
                />
              </div>
              {fieldErrors.phone && (
                <div className="auth-field-error">{fieldErrors.phone}</div>
              )}
            </div>

            <div className="auth-field">
              <label htmlFor="email">Email</label>
              <div
                className={`auth-input-wrap${fieldErrors.email ? " error" : ""}`}
              >
                <IconMail size={15} />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={update("email")}
                />
              </div>
              {fieldErrors.email && (
                <div className="auth-field-error">{fieldErrors.email}</div>
              )}
              <div className="auth-field-hint">
                We'll send you an email. Open it and tap the link to confirm
                it's you before you book.
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="password">Password</label>
              <div
                className={`auth-input-wrap${fieldErrors.password ? " error" : ""}`}
              >
                <IconLock size={15} />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Create a password"
                  value={form.password}
                  onChange={update("password")}
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
              {form.password && (
                <>
                  <div className="auth-strength">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={`auth-strength-bar${pwStrength.score >= i ? ` filled-${pwStrength.score}` : ""}`}
                      />
                    ))}
                  </div>
                  <div className="auth-strength-label">{pwStrength.label}</div>
                </>
              )}
              {pwIssues.length > 0 && form.password && (
                <ul className="auth-checklist">
                  {[
                    "At least 10 characters",
                    "A lowercase letter",
                    "An uppercase letter",
                    "A number",
                    "A symbol",
                  ].map((rule) => (
                    <li
                      key={rule}
                      className={pwIssues.includes(rule) ? "" : "met"}
                    >
                      {pwIssues.includes(rule) ? "○" : "✓"} {rule}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="auth-field">
              <label htmlFor="confirm">Confirm password</label>
              <div
                className={`auth-input-wrap${fieldErrors.confirm ? " error" : ""}`}
              >
                <IconLock size={15} />
                <input
                  id="confirm"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Repeat your password"
                  value={form.confirm}
                  onChange={update("confirm")}
                />
              </div>
              {fieldErrors.confirm && (
                <div className="auth-field-error">{fieldErrors.confirm}</div>
              )}
            </div>

            <label
              className="auth-remember"
              style={{ alignItems: "flex-start", marginBottom: 12 }}
            >
              <input
                type="checkbox"
                checked={adultChecked}
                onChange={(e) => setAdultChecked(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>{AGE_DECLARATION_TEXT}</span>
            </label>
            {fieldErrors.adult && (
              <div
                className="auth-field-error"
                style={{ marginTop: -6, marginBottom: 14 }}
              >
                {fieldErrors.adult}
              </div>
            )}

            <label
              className="auth-remember"
              style={{ alignItems: "flex-start", marginBottom: 16 }}
            >
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                I agree to the{" "}
                <Link
                  to="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: "var(--auth-secondary)",
                    textDecoration: "underline",
                  }}
                >
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link
                  to="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: "var(--auth-secondary)",
                    textDecoration: "underline",
                  }}
                >
                  Privacy Policy
                </Link>
                .
              </span>
            </label>
            {fieldErrors.consent && (
              <div
                className="auth-field-error"
                style={{ marginTop: -10, marginBottom: 14 }}
              >
                {fieldErrors.consent}
              </div>
            )}

            <button type="submit" className="auth-submit" disabled={submitting}>
              {submitting ? (
                <HealthcarePreloader label="" size={18} />
              ) : (
                "Create account"
              )}
            </button>
          </form>

          <p className="auth-switch">
            Already have an account? <Link to="/signin">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
