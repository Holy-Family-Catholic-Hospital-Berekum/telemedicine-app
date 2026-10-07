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

  // Warning colours: red band, yellow-and-black hazard stripe, red call
  // button. Gentle entrance and a pulsing icon (both off for visitors who
  // ask for reduced motion).
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={close}
    >
      <style>{`
        @keyframes emergencyIn { from { opacity: 0; transform: translateY(16px) scale(.97); } to { opacity: 1; transform: none; } }
        @keyframes emergencyPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(255, 214, 0, .7); } 50% { box-shadow: 0 0 0 10px rgba(255, 214, 0, 0); } }
        .emergency-card { animation: emergencyIn .35s ease-out both; }
        .emergency-icon { animation: emergencyPulse 1.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .emergency-card, .emergency-icon { animation: none; } }
      `}</style>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="emergency-title"
        aria-describedby="emergency-body"
        className="emergency-card w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl ring-4 ring-[#FFD600]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hazard stripe */}
        <div
          aria-hidden="true"
          className="h-3 w-full"
          style={{ background: "repeating-linear-gradient(-45deg, #FFD600 0 14px, #1A1A1A 14px 28px)" }}
        />
        <div className="flex items-center gap-3 bg-[#C62828] px-6 py-4 text-white">
          <span className="emergency-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#FFD600] text-[#C62828]">
            <svg width="26" height="26" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M10 3.5 17.5 16.5h-15L10 3.5Z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              <path d="M10 8.5v3.5M10 14.2v.1" stroke="#FFD600" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <h2 id="emergency-title" className="text-[21px] font-bold uppercase tracking-wide">
            Not for emergencies
          </h2>
        </div>
        <div className="bg-[#FFF8D6] px-6 py-5">
          <p id="emergency-body" className="text-[16px] leading-relaxed text-[#3A2A00]">
            This service is for booked appointments only. If you or someone else
            needs urgent help, call{" "}
            <strong className="rounded bg-[#C62828] px-1.5 py-0.5 text-white">112</strong>{" "}
            now, or go straight to the nearest hospital emergency unit.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href="tel:112"
              className="inline-flex items-center gap-2 rounded-full bg-[#C62828] px-5 py-3 text-[16px] font-bold text-white shadow-md transition hover:brightness-110"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M4.5 3.5h2.7c.5 0 .9.3 1 .8l.7 2.6c.1.4 0 .9-.3 1.2L7.3 9.4c1 2.1 2.7 3.8 4.8 4.8l1.3-1.3c.3-.3.8-.4 1.2-.3l2.6.7c.5.1.8.5.8 1v2.7c0 .6-.5 1-1 1-6.9 0-12.5-5.6-12.5-12.5 0-.5.4-1 1-1z"
                  fill="currentColor"
                />
              </svg>
              Call 112
            </a>
            <button
              ref={buttonRef}
              type="button"
              onClick={close}
              className="rounded-full border-2 border-[#3A2A00]/30 bg-white px-5 py-3 text-[16px] font-semibold text-[#3A2A00] transition hover:border-[#3A2A00]/60"
            >
              I understand
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
