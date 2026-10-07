import { useEffect, useRef, useState } from "react";

// "Not for emergencies" notice (medical director). Pops up DELAY_MS after
// the home page opens, once per visit: dismissing it is remembered for the
// browser tab's session (sessionStorage), so it shows again on the next
// visit but not when the patient comes back to Home in the same visit.
// Storage can be blocked (private mode); then it simply shows each time.

const DELAY_MS = 5000;
const SEEN_FLAG = "hfch.emergencyNoticeSeen";

function seen() {
  try {
    return sessionStorage.getItem(SEEN_FLAG) === "1";
  } catch {
    return false;
  }
}

export default function EmergencyNotice() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (seen()) return undefined;
    const id = setTimeout(() => setOpen(true), DELAY_MS);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    buttonRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    try {
      sessionStorage.setItem(SEEN_FLAG, "1");
    } catch {
      /* storage blocked: it will show again next time */
    }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={close}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="emergency-title"
        aria-describedby="emergency-body"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#B23A3A]/10 text-[#B23A3A]">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M10 3.5 17.5 16.5h-15L10 3.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              <path d="M10 8.5v3.5M10 14.2v.1" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            </svg>
          </span>
          <h2 id="emergency-title" className="text-[19px] font-semibold text-[#12242C]">
            Not for emergencies
          </h2>
        </div>
        <p id="emergency-body" className="mt-3 text-[16px] leading-relaxed text-[#3E4E56]">
          This service is for booked appointments only. If you or someone else
          needs urgent help, call <strong className="text-[#12242C]">112</strong>{" "}
          now, or go straight to the nearest hospital emergency unit.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href="tel:112"
            className="rounded-full border border-[#B23A3A]/40 px-5 py-2.5 text-[16px] font-semibold text-[#B23A3A]"
          >
            Call 112
          </a>
          <button
            ref={buttonRef}
            type="button"
            onClick={close}
            className="rounded-full bg-[#0095D9] px-5 py-2.5 text-[16px] font-semibold text-white"
          >
            I understand
          </button>
        </div>
      </div>
    </div>
  );
}
