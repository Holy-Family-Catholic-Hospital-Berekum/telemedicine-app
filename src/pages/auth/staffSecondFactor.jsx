// staffSecondFactor.jsx
//
// The second step of a staff sign-in (see authContext note 5):
//   kind "totp"        admin: code from the authenticator app
//   kind "totp_enroll" admin without an authenticator: set one up now
//   kind "email_code"  doctor: code emailed for this sign-in
// Rendered by signIn.jsx in place of the password form.

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useAuth } from "../../context/authContext.jsx";
import HealthcarePreloader from "../../components/common/healthcarePreloader.jsx";
import { IconAlert, IconCheckCircle, IconLock } from "../../components/auth/icons.jsx";

function CodeInput({ value, onChange, label }) {
  return (
    <div className="auth-field">
      <label htmlFor="staff-code">{label}</label>
      <div className="auth-input-wrap">
        <IconLock size={15} />
        <input
          id="staff-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          autoFocus
          placeholder="123456"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
          style={{ letterSpacing: "0.3em", fontSize: 20 }}
        />
      </div>
    </div>
  );
}

function Alert({ error }) {
  if (!error) return null;
  return (
    <div className="auth-alert" role="alert">
      <IconAlert size={15} />
      <span>{error}</span>
    </div>
  );
}

function SubmitButton({ busy, children, disabled }) {
  return (
    <button type="submit" className="auth-submit" disabled={busy || disabled}>
      {busy ? <HealthcarePreloader label="" size={18} /> : children}
    </button>
  );
}

function CancelLink({ onCancel }) {
  return (
    <p className="auth-switch">
      <button
        type="button"
        onClick={onCancel}
        style={{ background: "none", border: "none", color: "var(--auth-secondary)", cursor: "pointer" }}
      >
        Cancel and start again
      </button>
    </p>
  );
}

/** Admin with an authenticator: enter its code. */
function TotpCode({ step, onSignedIn, onCancel }) {
  const { completeTotpSignIn } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await completeTotpSignIn({ resolver: step.resolver, hintUid: step.hintUid, code });
      onSignedIn(result);
    } catch (err) {
      setError(err.message || "That code didn't work.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="auth-card-head">
        <h2>Authenticator code</h2>
        <p>Open your authenticator app and enter the 6-digit code for Holy Family Telemedicine.</p>
      </div>
      <Alert error={error} />
      <CodeInput value={code} onChange={setCode} label="6-digit code" />
      <SubmitButton busy={busy} disabled={code.length !== 6}>Verify and sign in</SubmitButton>
      <CancelLink onCancel={onCancel} />
    </form>
  );
}

/** Admin without an authenticator: set one up, then sign in again. */
function TotpEnroll({ onEnrolled, onCancel }) {
  const { startTotpEnrollment, finishTotpEnrollment } = useAuth();
  const [setup, setSetup] = useState(null); // { secret, key, qrUrl }
  const canvasRef = useRef(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    startTotpEnrollment()
      .then(async ({ secret, qrUrl, key }) => {
        if (active) setSetup({ secret, key, qrUrl });
      })
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, [startTotpEnrollment]);

  // Drawn straight onto a canvas (nothing is fed to an image URL). If it
  // fails, the typed key below still works.
  useEffect(() => {
    if (setup?.qrUrl && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, setup.qrUrl, { margin: 1, width: 220 }).catch(() => {});
    }
  }, [setup]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await finishTotpEnrollment({ secret: setup.secret, code });
      onEnrolled();
    } catch (err) {
      setError(err.message || "That code didn't work.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="auth-card-head">
        <h2>Set up your authenticator</h2>
        <p>
          Admin accounts need an authenticator app (Google Authenticator,
          Microsoft Authenticator or similar) on a phone only you use.
        </p>
      </div>
      <Alert error={error} />
      {!setup && !error && <HealthcarePreloader label="Preparing…" size={28} />}
      {setup && (
        <>
          <ol style={{ margin: "0 0 14px", paddingLeft: 20, lineHeight: 1.6 }}>
            <li>In the app, choose to add an account and scan this code.</li>
            <li>Type the 6-digit code the app shows.</li>
          </ol>
          <div style={{ textAlign: "center", marginBottom: 12 }}>
            <canvas
              ref={canvasRef}
              width={220}
              height={220}
              role="img"
              aria-label="QR code to add this account to your authenticator app"
            />
          </div>
          <p style={{ fontSize: 14, marginBottom: 14, wordBreak: "break-all" }}>
            Can't scan? Enter this key instead:{" "}
            <code style={{ fontWeight: 700 }}>{setup.key.match(/.{1,4}/g).join(" ")}</code>
          </p>
          <CodeInput value={code} onChange={setCode} label="Code from the app" />
          <SubmitButton busy={busy} disabled={code.length !== 6}>Finish setup</SubmitButton>
        </>
      )}
      <CancelLink onCancel={onCancel} />
    </form>
  );
}

/** Doctor: code from the email. */
function EmailCode({ step, onSignedIn, onCancel }) {
  const { submitStaffCode, resendStaffCode } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNote("");
    try {
      onSignedIn(await submitStaffCode(code));
    } catch (err) {
      setError(err.message || "That code didn't work.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError("");
    setNote("");
    try {
      const data = await resendStaffCode();
      setNote(data?.status === "ok" ? "" : "A new code is on its way. Use the newest email.");
    } catch (err) {
      setError(err?.message || "We couldn't send a new code. Wait a few minutes and try again.");
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="auth-card-head">
        <h2>Check your email</h2>
        <p>We sent a 6-digit sign-in code to {step.sentTo || "your email"}. It expires in 10 minutes.</p>
      </div>
      <Alert error={error} />
      {note && (
        <div className="auth-alert success" role="status">
          <IconCheckCircle size={15} />
          <span>{note}</span>
        </div>
      )}
      <CodeInput value={code} onChange={setCode} label="6-digit code" />
      <SubmitButton busy={busy} disabled={code.length !== 6}>Verify and sign in</SubmitButton>
      <p className="auth-switch">
        No email?{" "}
        <button
          type="button"
          onClick={resend}
          style={{ background: "none", border: "none", color: "var(--auth-secondary)", cursor: "pointer", padding: 0 }}
        >
          Send a new code
        </button>{" "}
        (check spam too)
      </p>
      <CancelLink onCancel={onCancel} />
    </form>
  );
}

export default function StaffSecondFactor({ step, onSignedIn, onDone }) {
  const { cancelStaffSignIn } = useAuth();
  const cancel = async () => {
    await cancelStaffSignIn();
    onDone();
  };
  if (step.kind === "totp") return <TotpCode step={step} onSignedIn={onSignedIn} onCancel={cancel} />;
  if (step.kind === "totp_enroll") {
    return <TotpEnroll onEnrolled={() => onDone("enrolled")} onCancel={cancel} />;
  }
  return <EmailCode step={step} onSignedIn={onSignedIn} onCancel={cancel} />;
}
