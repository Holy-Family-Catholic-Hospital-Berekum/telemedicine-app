// VerifyEmailNotice.jsx — small helper page ProtectedRoute redirects
// unverified patients to. Keep it simple; it's a waiting room, not a form.
//
// Verification happens in a different tab (or a different device
// entirely, if the patient opens the email on their phone), so this page
// can't wait for a click here — it has to go check. It polls
// refreshEmailVerified() every few seconds and redirects the moment
// Firebase confirms the link was clicked, with a manual "I've verified"
// button for anyone who doesn't want to wait for the next poll.

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/authContext.jsx";
import { IconMail, IconCheckCircle } from "../../components/auth/icons.jsx";
import "../../styles/auth.css";
import { usePageMeta } from "../../seo.js";

const POLL_INTERVAL_MS = 4000;

export default function VerifyEmailNotice() {
  usePageMeta({ title: "Verify your email", noindex: true });
  const {
    user,
    emailVerified,
    refreshEmailVerified,
    resendVerificationEmail,
    signOutUser,
  } = useAuth();
  const navigate = useNavigate();
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);

  // The moment context reports verified — whether that came from the
  // poll below or the manual button — leave this page.
  useEffect(() => {
    if (emailVerified) navigate("/", { replace: true });
  }, [emailVerified, navigate]);

  // Quiet background poll. This is what makes the common case (patient
  // clicks the link in their email app, then comes back to this tab)
  // work with no extra click at all.
  useEffect(() => {
    if (emailVerified) return;
    const id = setInterval(() => {
      refreshEmailVerified();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [emailVerified, refreshEmailVerified]);

  const handleManualCheck = useCallback(async () => {
    setChecking(true);
    try {
      await refreshEmailVerified();
    } finally {
      setChecking(false);
    }
  }, [refreshEmailVerified]);

  const handleResend = async () => {
    setSending(true);
    try {
      await resendVerificationEmail();
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="auth-root" style={{ gridTemplateColumns: "1fr" }}>
      <div className="auth-formside">
        <div className="auth-card" style={{ textAlign: "center" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginBottom: 18,
            }}
          >
            <div
              className="auth-aside-mark"
              style={{
                background: "var(--auth-surface)",
                border: "1px solid var(--auth-border)",
              }}
            >
              <IconMail size={18} />
            </div>
          </div>
          <div className="auth-card-head">
            <h2>Verify your email</h2>
            <p>
              We sent a verification link to <strong>{user?.email}</strong>.
              Open it, then come back here — this page checks automatically and
              will continue on its own.
            </p>
          </div>

          {sent && (
            <div className="auth-alert success">
              <IconCheckCircle size={15} />
              <span>Verification email sent.</span>
            </div>
          )}

          <button
            className="auth-submit"
            onClick={handleManualCheck}
            disabled={checking}
          >
            {checking ? "Checking…" : "I've verified, check now"}
          </button>

          <p className="auth-switch">
            Didn't get the email?{" "}
            <button
              type="button"
              onClick={handleResend}
              disabled={sending}
              style={{
                background: "none",
                border: "none",
                color: "var(--auth-secondary)",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              {sending ? "Sending…" : "Resend it"}
            </button>
          </p>
          <p className="auth-switch">
            Wrong account?{" "}
            <button
              type="button"
              onClick={() => {
                signOutUser();
                navigate("/signin");
              }}
              style={{
                background: "none",
                border: "none",
                color: "var(--auth-secondary)",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Sign out
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
