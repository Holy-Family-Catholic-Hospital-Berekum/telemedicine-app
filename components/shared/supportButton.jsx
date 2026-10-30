import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { MessageCircle, X } from "lucide-react";
import { useAuth } from "../../src/context/authContext.jsx";
import { SUPPORT_WHATSAPP } from "./contact";

// Floating "Help" button on patient pages (every route wrapped in
// PatientPage, App.jsx).
//   Signed-in patient with a verified email: in-app messages to the support
//     team (components/patient/support/, functions/support.js). A reply they
//     haven't read shows a badge and a "Support has replied" banner on every
//     patient page; /dashboard#support (the reply email's link) opens it.
//   Everyone else (signed out, email not verified yet): WhatsApp, with a
//     short starter message and nothing about the visitor filled in.
// The messages code (and Firebase) loads only for a signed-in patient, so
// public pages stay as light as before.
// Sits under modals and the video call (z-40), and above the Home page's
// mobile booking bar.

const SupportPanel = lazy(() => import("../patient/support/supportPanel.jsx"));
const loadService = () => import("../patient/support/supportService.js");

const STARTER = "Hello Holy Family Catholic Hospital, I need help with the telemedicine service.";
// A failed unread listener (e.g. the connection dropped) is tried again.
const RETRY_MS = 60 * 1000;

/** Live ids of the patient's conversations with an unread reply. */
function useUnreadReplies(uid) {
  const [unread, setUnread] = useState([]);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!uid) return undefined;
    let stop = () => {};
    let retry = null;
    let live = true;
    loadService().then(
      ({ watchUnread }) => {
        if (!live) return;
        stop = watchUnread(uid, setUnread, () => {
          retry = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
        });
      },
      () => {
        retry = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
      },
    );
    return () => {
      live = false;
      stop();
      clearTimeout(retry);
    };
  }, [uid, attempt]);
  return uid ? unread : [];
}

function WhatsAppPanel({ signedIn }) {
  const href = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(STARTER)}`;
  return (
    <>
      <p className="mt-1.5 text-[16px] leading-relaxed text-[#3E4E56]">
        Send our support team a message on WhatsApp about bookings,
        payments or joining your consultation.
      </p>
      <p className="mt-2 text-[14px] text-[#8A2626]">
        For an emergency, call 112 or go to the nearest hospital. We will
        never ask you to send money on WhatsApp, or ask for your mobile
        money PIN, password or a code sent to your phone.
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
      {!signedIn && (
        <p className="mt-3 text-center text-[14px] text-[#3E4E56]">
          Have an account?{" "}
          <Link to="/signin" className="font-semibold text-[#0b6ba0] hover:underline">
            Sign in
          </Link>{" "}
          to message us here instead.
        </p>
      )}
    </>
  );
}

export default function SupportButton() {
  const { pathname, hash } = useLocation();
  const { user, role, emailVerified } = useAuth();
  const inApp = Boolean(user && role === "patient" && emailVerified);
  const uid = inApp ? user.uid : null;
  const unread = useUnreadReplies(uid);

  // The page the panel was opened on: moving to another page closes it.
  const [openOn, setOpenOn] = useState(null);
  const open = openOn === pathname;
  // The conversation to open with (a reply from the banner).
  const [startThread, setStartThread] = useState(null);
  // Replies whose banner the patient closed (it comes back for a new one).
  const [dismissed, setDismissed] = useState("");

  // The reply email links to /dashboard#support: open once on arrival.
  const [hashOpened, setHashOpened] = useState(null);
  const hashTarget = inApp && hash === "#support" ? pathname : null;
  if (hashTarget && hashOpened !== hashTarget) {
    setHashOpened(hashTarget);
    setOpenOn(hashTarget);
  }

  // Close with Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && setOpenOn(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function show(threadId = null) {
    setStartThread(threadId);
    setOpenOn(pathname);
  }

  const unreadKey = unread.join(",");
  const banner = inApp && unread.length > 0 && !open && dismissed !== unreadKey;
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
          aria-label={inApp ? "Messages to support" : "Contact support on WhatsApp"}
          className={`max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-black/10 bg-white p-5 text-[#12242C] shadow-2xl ${
            inApp ? "w-[min(380px,calc(100vw-2rem))]" : "w-[min(320px,calc(100vw-2rem))]"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-[17px] font-semibold">{inApp ? "Help & support" : "Need help?"}</p>
            <button
              type="button"
              onClick={() => setOpenOn(null)}
              aria-label="Close"
              className="-m-2 rounded-full p-2 text-[#3E4E56] hover:bg-black/5"
            >
              <X size={20} />
            </button>
          </div>
          {inApp ? (
            <div className="mt-2">
              <Suspense fallback={<p className="text-[14px] text-[#3E4E56]">Loading your messages…</p>}>
                <SupportPanel key={startThread || "list"} uid={uid} openThreadId={startThread} />
              </Suspense>
            </div>
          ) : (
            <WhatsAppPanel signedIn={Boolean(user)} />
          )}
        </div>
      )}

      {banner && (
        <div
          role="status"
          className="flex max-w-[min(320px,calc(100vw-2rem))] items-center gap-2 rounded-2xl border border-black/10 bg-white py-2 pl-4 pr-2 text-[#12242C] shadow-xl"
        >
          <button type="button" onClick={() => show(unread[0])} className="text-left text-[15px] font-semibold">
            Support has replied to you.{" "}
            <span className="text-[#0b6ba0] underline">Read it</span>
          </button>
          <button
            type="button"
            onClick={() => setDismissed(unreadKey)}
            aria-label="Hide this message"
            className="rounded-full p-1.5 text-[#3E4E56] hover:bg-black/5"
          >
            <X size={18} />
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => (open ? setOpenOn(null) : show())}
        aria-expanded={open}
        aria-controls="support-panel"
        aria-label={
          open
            ? "Close support"
            : inApp
              ? unread.length
                ? `Help: ${unread.length} new ${unread.length === 1 ? "reply" : "replies"}`
                : "Help: message our support team"
              : "Chat with us on WhatsApp"
        }
        className={`relative flex h-14 items-center gap-2 rounded-full px-4 text-white shadow-[0_10px_30px_-8px_rgba(0,0,0,0.45)] transition focus:outline-none focus-visible:ring-4 ${
          inApp
            ? "bg-[#0b6ba0] hover:bg-[#095a87] focus-visible:ring-[#0b6ba0]/40"
            : "bg-[#1E8E5A] hover:bg-[#187a4c] focus-visible:ring-[#1E8E5A]/40"
        }`}
      >
        {open ? <X size={24} /> : <MessageCircle size={24} strokeWidth={2} />}
        {/* "Help" stays visible on phones: the reply email says to tap it. */}
        <span className={`text-[16px] font-semibold ${inApp ? "inline" : "hidden sm:inline"}`}>
          {open ? "Close" : inApp ? "Help" : "Chat with us"}
        </span>
        {!open && unread.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-[#C2410C] px-1.5 text-[14px] font-bold text-white ring-2 ring-white">
            {unread.length}
          </span>
        )}
      </button>
    </div>
  );
}
