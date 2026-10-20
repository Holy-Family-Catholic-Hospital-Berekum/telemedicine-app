import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "../../../src/context/authContext.jsx";

// Shown after signing in with a password that's on a public list of leaked
// passwords (src/passwordCheck.js). The fix is a new password, through
// Firebase's reset email (the same as "Forgot password?").
export default function PasswordWarning() {
  const { user, passwordLeaked, dismissPasswordWarning, resetPassword } = useAuth();
  const [state, setState] = useState("idle"); // idle | sending | sent | failed

  if (!passwordLeaked || !user?.email) return null;

  const send = async () => {
    setState("sending");
    try {
      await resetPassword(user.email);
      setState("sent");
    } catch {
      setState("failed");
    }
  };

  return (
    <div
      role="alert"
      className="mt-6 rounded-xl border border-[#E8B4A0] bg-[#FFF5F0] p-4 text-[#12242C] sm:p-5"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert size={22} className="mt-0.5 shrink-0 text-[#B4441C]" />
        <div className="min-w-0">
          <p className="text-base font-semibold">Please change your password</p>
          <p className="mt-1 text-base text-[#3E4E56]">
            The password you used has appeared in a data leak on another
            website, so criminals may try it. Choose a new one that you don't
            use anywhere else.
          </p>
          {state === "sent" ? (
            <p className="mt-3 text-base font-medium text-[#1E6B45]">
              We've emailed you a link to choose a new password. Check your
              spam folder too.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={send}
                disabled={state === "sending"}
                className="rounded-full bg-[#0B6BA0] px-5 py-2.5 text-base font-semibold text-white transition hover:brightness-95 disabled:opacity-60"
              >
                {state === "sending" ? "Sending…" : "Email me a link to change it"}
              </button>
              <button
                type="button"
                onClick={dismissPasswordWarning}
                className="text-base text-[#3E4E56] underline-offset-2 hover:underline"
              >
                Not now
              </button>
            </div>
          )}
          {state === "failed" && (
            <p className="mt-2 text-base text-[#8A2626]">
              We couldn't send the email. Check your connection and try again.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
