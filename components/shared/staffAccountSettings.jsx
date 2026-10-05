import { useState } from "react";
import { Loader2, UserRound, Mail, CheckCircle2 } from "lucide-react";
import { useAuth } from "../../src/context/authContext.jsx";
import { callableMessage } from "../../src/constants";

// "My account" for admins and doctors (admin sidebar, doctor portal tab).
//
// Name (and a doctor's department): updateStaffProfile. For doctors it also
// updates the public "Meet your doctors" entry and the doctor name on
// upcoming appointments; closed history keeps the old name.
//
// Email: the email is how a staff account is recovered, so changing it
// needs the current password AND an authenticator code (a fresh two-step
// sign-in). Firebase then emails a link to the NEW address and nothing
// changes until it's clicked (the old address is told, with a way to undo
// it). After that the staff member signs in with the new address; their
// authenticator stays the same. The change is audited and alerted.

const input =
  "mt-1.5 w-full rounded-md border border-[#C9D6DE] px-3 py-2.5 text-sm text-[#12242C] focus:border-[#0095D9] focus:outline-none focus:ring-2 focus:ring-[#0095D9]/20";
const label = "block text-sm font-medium text-[#12242C]";
const button =
  "mt-4 inline-flex items-center justify-center gap-2 rounded-md bg-[#0095D9] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60";

function Notice({ note }) {
  if (!note) return null;
  return (
    <p
      role={note.tone === "error" ? "alert" : "status"}
      className={`mt-3 flex items-start gap-2 rounded-md px-3 py-2.5 text-sm ${
        note.tone === "error" ? "bg-[#B23A3A]/10 text-[#8A2626]" : "bg-[#1E8E5A]/10 text-[#16683F]"
      }`}
    >
      {note.tone !== "error" && <CheckCircle2 size={18} className="mt-0.5 shrink-0" />}
      {note.text}
    </p>
  );
}

function ProfileCard() {
  const { profile, updateStaffProfile } = useAuth();
  const isDoctor = profile?.role === "doctor";
  const [name, setName] = useState(profile?.name || "");
  const [department, setDepartment] = useState(profile?.department || "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const unchanged =
    name.trim() === (profile?.name || "") &&
    (!isDoctor || department.trim() === (profile?.department || ""));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      await updateStaffProfile({ name, ...(isDoctor ? { department } : {}) });
      setNote({
        tone: "ok",
        text: isDoctor
          ? "Saved. Patients see the new details on the home page and their upcoming appointments."
          : "Saved.",
      });
    } catch (err) {
      setNote({ tone: "error", text: callableMessage(err, "We couldn't save your details. Please try again.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="rounded-lg border border-[#DCE6EC] bg-white p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-[#12242C]">
        <UserRound size={18} strokeWidth={1.75} className="text-[#0095D9]" />
        Your details
      </h2>
      <label htmlFor="staff-name" className={`${label} mt-4`}>
        Full name
      </label>
      <input
        id="staff-name"
        type="text"
        autoComplete="name"
        required
        minLength={2}
        maxLength={100}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={input}
      />
      {isDoctor && (
        <>
          <label htmlFor="staff-department" className={`${label} mt-4`}>
            Department
          </label>
          <input
            id="staff-department"
            type="text"
            required
            minLength={2}
            maxLength={80}
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="e.g. General Practice"
            className={input}
          />
        </>
      )}
      <button
        type="submit"
        disabled={busy || unchanged || name.trim().length < 2 || (isDoctor && department.trim().length < 2)}
        className={button}
      >
        {busy && <Loader2 size={16} className="animate-spin" />}
        Save details
      </button>
      <Notice note={note} />
    </form>
  );
}

function EmailCard() {
  const { user, requestEmailChange } = useAuth();
  const [email, setEmail] = useState("");
  const [currentPw, setCurrentPw] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const sameAsNow = email.trim().toLowerCase() === (user?.email || "").toLowerCase();

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      await requestEmailChange({ newEmail: email, currentPw, totpCode: code });
      setNote({
        tone: "ok",
        text: `We've sent a link to ${email.trim()}. Open it to confirm, then sign in with the new address (same authenticator). Until then, keep using your current one.`,
      });
      setCurrentPw("");
      setCode("");
    } catch (err) {
      setNote({ tone: "error", text: err.message || "We couldn't start the change. Please try again." });
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-[#DCE6EC] bg-white p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-[#12242C]">
        <Mail size={18} strokeWidth={1.75} className="text-[#0095D9]" />
        Sign-in email
      </h2>
      <p className="mt-1 text-sm text-[#5C6B72]">
        Current: <strong className="break-all text-[#12242C]">{user?.email}</strong>. This address
        is used to sign in and to reset your password, so changing it needs your password and
        your authenticator code.
      </p>
      <label htmlFor="staff-email" className={`${label} mt-4`}>
        New email address
      </label>
      <input
        id="staff-email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={input}
      />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="staff-password" className={label}>
            Current password
          </label>
          <input
            id="staff-password"
            type="password"
            autoComplete="current-password"
            required
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            className={input}
          />
        </div>
        <div>
          <label htmlFor="staff-totp" className={label}>
            Authenticator code
          </label>
          <input
            id="staff-totp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            className={`${input} tracking-[0.3em]`}
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={busy || !email.trim() || !currentPw || code.length !== 6 || sameAsNow}
        className={button}
      >
        {busy && <Loader2 size={16} className="animate-spin" />}
        Change email
      </button>
      <Notice note={note} />
    </form>
  );
}

export default function StaffAccountSettings() {
  return (
    <div className="grid max-w-3xl gap-5">
      <ProfileCard />
      <EmailCard />
    </div>
  );
}
