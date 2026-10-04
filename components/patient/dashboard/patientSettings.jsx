import { useState } from "react";
import { Loader2, UserRound, Mail, CheckCircle2 } from "lucide-react";
import { useAuth } from "../../../src/context/authContext.jsx";
import { callableMessage } from "../../../src/constants";

// Patient Settings tab: change the name on the account, and the sign-in
// email address.
//
// Name: updatePatientProfile (server). It applies to the account and new
// bookings; bookings already made keep the name they were made with.
//
// Email: needs the current password, then Firebase emails a link to the
// NEW address and nothing changes until it's clicked (the old address is
// told, with a way to undo). After that the patient signs in with the new
// address, and authContext copies it to their profile and open bookings
// (syncAccountEmail) so appointment emails go there.

const inputClass =
  "mt-1.5 w-full rounded-lg border border-[#C9D6DE] px-4 py-3 text-base text-[#12242C] focus:border-[#0095D9] focus:outline-none focus:ring-2 focus:ring-[#0095D9]/20";
const labelClass = "block text-base font-medium text-[#12242C]";
const buttonClass =
  "mt-4 inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60";

function Notice({ note }) {
  if (!note) return null;
  return (
    <p
      role={note.tone === "error" ? "alert" : "status"}
      className={`mt-3 flex items-start gap-2 rounded-lg px-4 py-3 text-base ${
        note.tone === "error" ? "bg-[#B23A3A]/10 text-[#8A2626]" : "bg-[#1E8E5A]/10 text-[#16683F]"
      }`}
    >
      {note.tone !== "error" && <CheckCircle2 size={20} className="mt-0.5 shrink-0" />}
      {note.text}
    </p>
  );
}

function NameCard() {
  const { profile, updatePatientName } = useAuth();
  const [name, setName] = useState(profile?.name || "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const unchanged = name.trim() === (profile?.name || "");

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      await updatePatientName(name);
      setNote({ tone: "ok", text: "Your name has been updated." });
    } catch (err) {
      setNote({ tone: "error", text: callableMessage(err, "We couldn't save your name. Please try again.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="rounded-xl border border-[#DCE6EC] p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-xl font-semibold text-[#12242C]">
        <UserRound size={22} strokeWidth={1.75} className="text-[#0095D9]" />
        Your name
      </h2>
      <p className="mt-1 text-base text-[#3E4E56]">
        This is the name the hospital sees on your new bookings.
      </p>
      <label htmlFor="settings-name" className={`${labelClass} mt-4`}>
        Full name
      </label>
      <input
        id="settings-name"
        type="text"
        autoComplete="name"
        required
        minLength={2}
        maxLength={100}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={inputClass}
      />
      <button
        type="submit"
        disabled={busy || unchanged || name.trim().length < 2}
        className={buttonClass}
        style={{ backgroundColor: "#0095D9" }}
      >
        {busy && <Loader2 size={18} className="animate-spin" />}
        Save name
      </button>
      <Notice note={note} />
    </form>
  );
}

function EmailCard() {
  const { user, requestEmailChange } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const sameAsNow = email.trim().toLowerCase() === (user?.email || "").toLowerCase();

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      await requestEmailChange({ newEmail: email, password });
      setNote({
        tone: "ok",
        text: `We've sent a link to ${email.trim()}. Open it to confirm the change, then sign in with your new email address. Until then, keep using your current one.`,
      });
      setPassword("");
    } catch (err) {
      setNote({ tone: "error", text: err.message || "We couldn't start the change. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-[#DCE6EC] p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-xl font-semibold text-[#12242C]">
        <Mail size={22} strokeWidth={1.75} className="text-[#0095D9]" />
        Your email address
      </h2>
      <p className="mt-1 text-base text-[#3E4E56]">
        You sign in with this address, and we send your appointment emails
        to it. Current address:{" "}
        <strong className="break-all text-[#12242C]">{user?.email}</strong>
      </p>
      <label htmlFor="settings-email" className={`${labelClass} mt-4`}>
        New email address
      </label>
      <input
        id="settings-email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={inputClass}
      />
      <label htmlFor="settings-password" className={`${labelClass} mt-4`}>
        Your current password
      </label>
      <input
        id="settings-password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={inputClass}
      />
      <p className="mt-1.5 text-sm text-[#3E4E56]">
        We ask for your password to make sure it's really you.
      </p>
      <button
        type="submit"
        disabled={busy || !email.trim() || !password || sameAsNow}
        className={buttonClass}
        style={{ backgroundColor: "#0095D9" }}
      >
        {busy && <Loader2 size={18} className="animate-spin" />}
        Change email
      </button>
      <Notice note={note} />
    </form>
  );
}

export default function PatientSettings() {
  return (
    <div className="space-y-6">
      <NameCard />
      <EmailCard />
    </div>
  );
}
