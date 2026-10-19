import { useEffect, useRef, useState } from "react";
import { Loader2, PenLine, CheckCircle2 } from "lucide-react";
import { useAuth } from "../../src/context/authContext.jsx";
import { callableMessage } from "../../src/constants";
import { fetchPrescriberDetails, updatePrescriberDetails } from "./docFirestoreService";
import SignaturePad from "./signaturePad";

// Doctor's Account tab: the MDC registration number and drawn signature
// printed on their prescriptions (functions/prescriptions.js
// updatePrescriberDetails). Both are needed before a prescription can be
// written. Saving needs the password and authenticator code (a fresh
// sign-in), and is audited. Prescriptions already issued keep the
// signature they were issued with.

const input =
  "mt-1.5 w-full rounded-md border border-[#C9D6DE] px-3 py-2.5 text-sm text-[#12242C] focus:border-[#0095D9] focus:outline-none focus:ring-2 focus:ring-[#0095D9]/20";
const label = "block text-sm font-medium text-[#12242C]";

export default function PrescriberDetails() {
  const { user, confirmIdentity } = useAuth();
  const padRef = useRef(null);
  const [current, setCurrent] = useState(null); // { mdcNumber, signature }
  const [loadError, setLoadError] = useState(false);
  const [mdc, setMdc] = useState("");
  const [drawing, setDrawing] = useState(false); // drawing a new signature
  const [hasInk, setHasInk] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;
    let active = true;
    fetchPrescriberDetails(user.uid)
      .then((d) => {
        if (!active) return;
        setCurrent(d);
        setMdc(d.mdcNumber || "");
        setDrawing(!d.signature);
      })
      .catch(() => active && setLoadError(true));
    return () => {
      active = false;
    };
  }, [user?.uid]);

  const mdcChanged = mdc.trim().toUpperCase() !== (current?.mdcNumber || "") && mdc.trim().length >= 3;
  const signatureChanged = drawing && hasInk;

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const signature = signatureChanged ? padRef.current.toPng() : undefined;
      await confirmIdentity({ currentPw, totpCode: code });
      const result = await updatePrescriberDetails({
        ...(mdcChanged ? { mdcNumber: mdc.trim() } : {}),
        ...(signature ? { signature } : {}),
      });
      setCurrent((c) => ({
        mdcNumber: result.mdcNumber || c?.mdcNumber || null,
        signature: signature || c?.signature || null,
      }));
      setMdc(result.mdcNumber || mdc.trim().toUpperCase());
      setDrawing(false);
      setHasInk(false);
      setNote({ tone: "ok", text: "Saved. Your next prescriptions will use these details." });
    } catch (err) {
      // confirmIdentity throws plain Errors with a message for the user;
      // the save itself, callable errors.
      setNote({
        tone: "error",
        text: err?.code
          ? callableMessage(err, "We couldn't save. Please try again.")
          : err?.message || "We couldn't save. Please try again.",
      });
    } finally {
      setCurrentPw("");
      setCode("");
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-[#DCE6EC] bg-white p-5 text-sm text-[#5C6B72]">
        Couldn&apos;t load your prescription details. Please refresh.
      </div>
    );
  }

  return (
    <form onSubmit={save} className="rounded-lg border border-[#DCE6EC] bg-white p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-[#12242C]">
        <PenLine size={18} strokeWidth={1.75} className="text-[#0095D9]" />
        Prescription signature
      </h2>
      <p className="mt-1 text-sm text-[#5C6B72]">
        Printed on the prescriptions you write after video consultations. You need both before you can
        write one. Saving asks for your password and authenticator code.
      </p>
      {current === null ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-[#5C6B72]">
          <Loader2 size={15} className="animate-spin" /> Loading…
        </p>
      ) : (
        <>
          <label htmlFor="rx-mdc" className={`${label} mt-4`}>
            MDC registration number
          </label>
          <input
            id="rx-mdc"
            type="text"
            maxLength={30}
            value={mdc}
            onChange={(e) => setMdc(e.target.value)}
            placeholder="e.g. MDC/RN/12345"
            className={`${input} uppercase`}
          />

          <p className={`${label} mt-4`}>Signature</p>
          {drawing ? (
            <div className="mt-1.5">
              <SignaturePad ref={padRef} onChange={setHasInk} />
              {current.signature && (
                <button
                  type="button"
                  onClick={() => {
                    setDrawing(false);
                    setHasInk(false);
                  }}
                  className="mt-1 text-sm text-[#0095D9] hover:underline"
                >
                  Keep my current signature
                </button>
              )}
            </div>
          ) : (
            <div className="mt-1.5 flex flex-wrap items-end gap-4">
              <img
                src={current.signature}
                alt="Your current signature"
                className="h-20 rounded-md border border-[#DCE6EC] bg-white px-3"
              />
              <button
                type="button"
                onClick={() => setDrawing(true)}
                className="text-sm font-medium text-[#0095D9] hover:underline"
              >
                Draw a new signature
              </button>
            </div>
          )}

          {(mdcChanged || signatureChanged) && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="rx-password" className={label}>
                  Current password
                </label>
                <input
                  id="rx-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  className={input}
                />
              </div>
              <div>
                <label htmlFor="rx-totp" className={label}>
                  Authenticator code
                </label>
                <input
                  id="rx-totp"
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
          )}

          <button
            type="submit"
            disabled={busy || !(mdcChanged || signatureChanged) || !currentPw || code.length !== 6}
            className="mt-4 inline-flex items-center justify-center gap-2 rounded-md bg-[#0095D9] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            Save
          </button>
        </>
      )}
      {note && (
        <p
          role={note.tone === "error" ? "alert" : "status"}
          className={`mt-3 flex items-start gap-2 rounded-md px-3 py-2.5 text-sm ${
            note.tone === "error" ? "bg-[#B23A3A]/10 text-[#8A2626]" : "bg-[#1E8E5A]/10 text-[#16683F]"
          }`}
        >
          {note.tone !== "error" && <CheckCircle2 size={18} className="mt-0.5 shrink-0" />}
          {note.text}
        </p>
      )}
    </form>
  );
}
