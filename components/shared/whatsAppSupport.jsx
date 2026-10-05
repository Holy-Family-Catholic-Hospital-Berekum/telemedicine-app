import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { MessageCircle, X } from "lucide-react";
import { SUPPORT_WHATSAPP } from "./contact";

// Floating "Chat with us" button on patient pages (added for every route
// wrapped in PatientPage, App.jsx). It opens WhatsApp with a short starter
// message; nothing about the patient is filled in automatically, so no
// personal data leaves the site unless they type it themselves.
// Sits under modals and the video call (z-40), and above the Home page's
// mobile booking bar.

const STARTER = "Hello Holy Family Catholic Hospital, I need help with the telemedicine service.";

export default function WhatsAppSupport() {
  const { pathname } = useLocation();
  // The page the panel was opened on: moving to another page closes it.
  const [openOn, setOpenOn] = useState(null);
  const open = openOn === pathname;
  const setOpen = (value) =>
    setOpenOn((current) => {
      const next = typeof value === "function" ? value(current === pathname) : value;
      return next ? pathname : null;
    });

  // Close with Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && setOpenOn(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const href = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(STARTER)}`;
  // Home has a fixed booking bar along the bottom on phones.
  const lift = pathname === "/" ? "bottom-[92px] sm:bottom-6" : "bottom-4 sm:bottom-6";

  return (
    <div
      className={`fixed right-4 z-40 flex flex-col items-end gap-3 sm:right-6 ${lift}`}
      style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {open && (
        <div
          id="support-panel"
          role="dialog"
          aria-label="Contact support on WhatsApp"
          className="w-[min(320px,calc(100vw-2rem))] rounded-2xl border border-black/10 bg-white p-5 text-[#12242C] shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-[17px] font-semibold">Need help?</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="-m-2 rounded-full p-2 text-[#3E4E56] hover:bg-black/5"
            >
              <X size={20} />
            </button>
          </div>
          <p className="mt-1.5 text-[16px] leading-relaxed text-[#3E4E56]">
            Send our support team a message on WhatsApp about bookings,
            payments or joining your consultation.
          </p>
          <p className="mt-2 text-[14px] text-[#8A2626]">
            For an emergency, call 112 or go to the nearest hospital. Never
            share your mobile money PIN or password.
          </p>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1E8E5A] px-4 py-3 text-[16px] font-semibold text-white transition hover:bg-[#187a4c]"
          >
            <MessageCircle size={20} strokeWidth={2} />
            Open WhatsApp
          </a>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="support-panel"
        aria-label={open ? "Close support" : "Chat with us on WhatsApp"}
        className="flex h-14 items-center gap-2 rounded-full bg-[#1E8E5A] px-4 text-white shadow-[0_10px_30px_-8px_rgba(0,0,0,0.45)] transition hover:bg-[#187a4c] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1E8E5A]/40"
      >
        {open ? <X size={24} /> : <MessageCircle size={24} strokeWidth={2} />}
        <span className="hidden text-[16px] font-semibold sm:inline">
          {open ? "Close" : "Chat with us"}
        </span>
      </button>
    </div>
  );
}
