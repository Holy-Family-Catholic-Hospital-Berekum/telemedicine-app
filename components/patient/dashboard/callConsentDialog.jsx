import { useEffect, useRef, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { CALL_CONSENT_TEXT } from "../../../src/consentText";

// Shown the first time a patient joins each video consultation. The patient
// must tick the box to continue; the server stores a consent record with
// the version and a hash of this exact wording (startVideoCall), and later
// joins of the same consultation don't ask again.
export default function CallConsentDialog({ onAgree, onCancel, busy }) {
  const [agreed, setAgreed] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    boxRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
      onClick={() => !busy && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="call-consent-title"
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id="call-consent-title"
            className="flex items-center gap-2 text-base font-semibold text-[#12242C]"
          >
            <ShieldCheck size={18} style={{ color: "#0095D9" }} />
            Before you join your video consultation
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
            className="text-[#5C6B72] hover:text-[#12242C]"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-[#12242C]">{CALL_CONSENT_TEXT}</p>

        <label className="mt-4 flex cursor-pointer items-start gap-3">
          <input
            ref={boxRef}
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span className="text-sm text-[#12242C]">
            I have read this and agree to have my consultation by video on these
            terms.
          </span>
        </label>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-sm border border-[#DCE6EC] px-4 py-2 text-sm font-medium text-[#12242C]"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={onAgree}
            disabled={!agreed || busy}
            className="rounded-sm px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: "#0095D9" }}
          >
            {busy ? "Joining…" : "Agree and join"}
          </button>
        </div>
      </div>
    </div>
  );
}
