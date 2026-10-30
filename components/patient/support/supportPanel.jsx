import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Plus, Send } from "lucide-react";

import { MODE_LABELS, TYPE_LABELS, callableMessage, formatDateTime } from "../../../src/constants";
import {
  closeSupportThread,
  fetchBookingsToLink,
  markSupportRead,
  sendSupportMessage,
  watchMessages,
  watchThreads,
} from "./supportService";
import {
  MESSAGE_MAX,
  OFFICE_HOURS_TEXT,
  SUPPORT_TOPICS,
  isOfficeOpen,
  nextOpening,
  openingPhrase,
} from "./supportHours";

// The signed-in patient's Help panel (opened from the floating button,
// components/shared/supportButton.jsx): their conversations with the
// support team, a new message, and one conversation. Messages are shown as
// plain text only (never HTML, links not made clickable), so a message
// can't carry a link that looks like it comes from the hospital.
//
// Unsent text is kept in memory while the page is open (closing the panel
// doesn't lose it), never stored on the device.

const drafts = new Map(); // "new" | threadId -> text

const STATUS = {
  waiting: { label: "Waiting for a reply", tone: "bg-amber-50 text-amber-800" },
  answered: { label: "Replied", tone: "bg-emerald-50 text-emerald-800" },
  closed: { label: "Closed", tone: "bg-black/5 text-[#3E4E56]" },
};

const bookingLabel = (b) =>
  [
    b.consultationId ? `Ref ${b.consultationId}` : "Waiting to be scheduled",
    TYPE_LABELS[b.type],
    MODE_LABELS[b.mode],
    b.scheduledTime ? formatDateTime(b.scheduledTime) : null,
  ]
    .filter(Boolean)
    .join(" · ");

function HoursNote() {
  const now = new Date();
  const open = isOfficeOpen(now);
  return (
    <p className="text-[14px] leading-snug text-[#3E4E56]">
      <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${open ? "bg-emerald-500" : "bg-amber-500"}`} />
      {open
        ? `We're open now and reply during ${OFFICE_HOURS_TEXT}.`
        : `We're closed now. We'll reply ${openingPhrase(nextOpening(now), now)}.`}
    </p>
  );
}

function MessageBox({ draftKey, onSend, placeholder, label }) {
  const [text, setText] = useState(() => drafts.get(draftKey) || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const update = (value) => {
    setText(value);
    drafts.set(draftKey, value);
  };
  const ok = text.trim().length >= 2 && text.length <= MESSAGE_MAX;

  async function submit(e) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(text);
      drafts.delete(draftKey);
      setText("");
    } catch (err) {
      setError(callableMessage(err, "Your message couldn't be sent. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3">
      <label className="sr-only" htmlFor={`support-text-${draftKey}`}>{label}</label>
      <textarea
        id={`support-text-${draftKey}`}
        value={text}
        onChange={(e) => update(e.target.value)}
        maxLength={MESSAGE_MAX}
        rows={4}
        placeholder={placeholder}
        className="w-full resize-none rounded-xl border border-black/15 px-3 py-2 text-[15px] text-[#12242C] focus:border-[#0b6ba0] focus:outline-none"
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-[14px] text-[#3E4E56]">
          {text.length > MESSAGE_MAX - 200 ? `${MESSAGE_MAX - text.length} characters left` : ""}
        </span>
        <button
          type="submit"
          disabled={!ok || busy}
          className="flex items-center gap-2 rounded-xl bg-[#0b6ba0] px-4 py-2.5 text-[15px] font-semibold text-white transition hover:bg-[#095a87] disabled:opacity-50"
        >
          <Send size={17} />
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-[14px] text-[#8A2626]">{error}</p>}
    </form>
  );
}

function NewMessage({ uid, onSent, onBack }) {
  const [topic, setTopic] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [bookings, setBookings] = useState([]);
  useEffect(() => {
    let live = true;
    fetchBookingsToLink(uid).then((list) => live && setBookings(list), () => {});
    return () => {
      live = false;
    };
  }, [uid]);

  async function send(text) {
    if (!topic) throw Object.assign(new Error("Choose what your message is about."), { code: "invalid-argument" });
    const res = await sendSupportMessage({ text, topic, ...(bookingId ? { bookingId } : {}) });
    onSent(res);
  }

  return (
    <div>
      {onBack && <BackButton onClick={onBack} />}
      <p className="text-[16px] font-semibold text-[#12242C]">New message</p>
      <label className="mt-3 block text-[14px] font-medium text-[#12242C]" htmlFor="support-topic">
        What is it about?
      </label>
      <select
        id="support-topic"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-[15px] text-[#12242C]"
      >
        <option value="">Choose one</option>
        {Object.entries(SUPPORT_TOPICS).map(([k, label]) => (
          <option key={k} value={k}>{label}</option>
        ))}
      </select>
      {bookings.length > 0 && (
        <>
          <label className="mt-3 block text-[14px] font-medium text-[#12242C]" htmlFor="support-booking">
            Which booking? (optional)
          </label>
          <select
            id="support-booking"
            value={bookingId}
            onChange={(e) => setBookingId(e.target.value)}
            className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-[15px] text-[#12242C]"
          >
            <option value="">Not about a booking</option>
            {bookings.map((b) => (
              <option key={b.id} value={b.id}>{bookingLabel(b)}</option>
            ))}
          </select>
        </>
      )}
      <MessageBox
        draftKey="new"
        onSend={send}
        label="Your message"
        placeholder="Tell us what you need help with. Please don't include medical details: your doctor can help with those during your consultation."
      />
    </div>
  );
}

function BackButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-2 mb-2 flex items-center gap-1 rounded-lg px-2 py-1 text-[14px] font-medium text-[#0b6ba0] hover:bg-black/5"
    >
      <ArrowLeft size={16} /> All messages
    </button>
  );
}

function Conversation({ thread, onBack, notice }) {
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  const [closing, setClosing] = useState(false);
  const endRef = useRef(null);

  useEffect(
    () => watchMessages(thread.id, setMessages, () => setError("We couldn't load this conversation.")),
    [thread.id],
  );
  // Seen: clears the reply badge.
  useEffect(() => {
    if (thread.unread) markSupportRead(thread.id);
  }, [thread.id, thread.unread]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function close() {
    setClosing(true);
    try {
      await closeSupportThread(thread.id);
    } catch (err) {
      setError(callableMessage(err, "That didn't go through. Please try again."));
    } finally {
      setClosing(false);
    }
  }

  const status = STATUS[thread.status] ?? STATUS.waiting;
  return (
    <div>
      <BackButton onClick={onBack} />
      <div className="flex items-start justify-between gap-2">
        <p className="text-[16px] font-semibold text-[#12242C]">{SUPPORT_TOPICS[thread.topic] ?? "Message"}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[14px] ${status.tone}`}>{status.label}</span>
      </div>
      {thread.booking && <p className="mt-0.5 text-[14px] text-[#3E4E56]">{bookingLabel(thread.booking)}</p>}

      <ol className="mt-3 max-h-[40vh] space-y-2 overflow-y-auto pr-1" aria-label="Messages">
        {messages.map((m) => {
          const mine = m.from === "patient";
          return (
            <li key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[15px] ${
                  mine ? "bg-[#0b6ba0] text-white" : "bg-[#EEF4F7] text-[#12242C]"
                }`}
              >
                {m.text}
              </div>
              <span className="mt-0.5 text-[14px] text-[#3E4E56]">
                {mine ? "You" : "Holy Family support"}
                {m.at ? ` · ${formatDateTime(m.at)}` : ""}
              </span>
            </li>
          );
        })}
        <li ref={endRef} aria-hidden="true" />
      </ol>

      {notice && <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-[14px] text-emerald-900">{notice}</p>}
      {error && <p role="alert" className="mt-2 text-[14px] text-[#8A2626]">{error}</p>}

      {thread.status === "closed" && (
        <p className="mt-3 text-[14px] text-[#3E4E56]">
          This conversation is closed. Writing again reopens it.
        </p>
      )}
      <MessageBox
        draftKey={thread.id}
        onSend={(text) => sendSupportMessage({ threadId: thread.id, text })}
        label="Your reply"
        placeholder="Write a reply"
      />
      {thread.status === "answered" && (
        <button
          type="button"
          onClick={close}
          disabled={closing}
          className="mt-2 flex items-center gap-1.5 text-[14px] font-medium text-[#0b6ba0] hover:underline disabled:opacity-50"
        >
          <CheckCircle2 size={16} /> My question is answered
        </button>
      )}
    </div>
  );
}

// openThreadId: the conversation to open with (the parent remounts the
// panel, by key, to open another).
export default function SupportPanel({ uid, openThreadId }) {
  const [threads, setThreads] = useState(null);
  const [error, setError] = useState(null);
  // "list" | "new" | a thread id
  const [view, setView] = useState(openThreadId || "list");
  const [notice, setNotice] = useState(null);

  useEffect(() => watchThreads(uid, setThreads, () => setError("We couldn't load your messages.")), [uid]);

  function sent({ threadId, officeOpen, opensAt }) {
    setNotice(
      officeOpen
        ? "Sent. We'll reply here and email you when we do."
        : `Sent. We're closed now, so we'll reply ${openingPhrase(new Date(opensAt), new Date())}. We've emailed you to confirm we have your message.`,
    );
    setView(threadId);
  }

  const thread = threads?.find((t) => t.id === view);
  const showList = view === "list" && threads?.length > 0;
  const showNew = view === "new" || (view === "list" && threads?.length === 0);

  return (
    <div>
      <HoursNote />
      <p className="mt-2 text-[14px] leading-snug text-[#3E4E56]">
        For help with bookings, payments, video calls or your account. For
        an emergency, call 112 or go to the nearest hospital.
      </p>
      <div className="mt-4">
        {error && <p role="alert" className="text-[14px] text-[#8A2626]">{error}</p>}
        {!error && threads === null && <p className="text-[14px] text-[#3E4E56]">Loading your messages…</p>}

        {showList && (
          <>
            <button
              type="button"
              onClick={() => {
                setNotice(null);
                setView("new");
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#0b6ba0] px-4 py-2.5 text-[15px] font-semibold text-[#0b6ba0] hover:bg-[#0b6ba0]/5"
            >
              <Plus size={18} /> New message
            </button>
            <ul className="mt-3 max-h-[45vh] divide-y divide-black/10 overflow-y-auto">
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setNotice(null);
                      setView(t.id);
                    }}
                    className="w-full py-2.5 text-left hover:bg-black/[0.03]"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-[15px] font-semibold text-[#12242C]">
                        {t.unread && <span className="h-2.5 w-2.5 rounded-full bg-[#C2410C]" aria-label="New reply" />}
                        {SUPPORT_TOPICS[t.topic] ?? "Message"}
                      </span>
                      <span className="shrink-0 text-[14px] text-[#3E4E56]">{(STATUS[t.status] ?? STATUS.waiting).label}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[14px] text-[#3E4E56]">
                      {t.lastFrom === "support" ? "Support: " : "You: "}
                      {t.preview}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {showNew && threads !== null && (
          <NewMessage uid={uid} onSent={sent} onBack={threads.length ? () => setView("list") : null} />
        )}

        {/* Just sent (the list catches up in a moment), or no longer there. */}
        {!thread && !showList && !showNew && threads !== null && (
          <>
            <BackButton onClick={() => setView("list")} />
            {notice && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-[14px] text-emerald-900">{notice}</p>}
          </>
        )}

        {thread && (
          <Conversation
            key={thread.id}
            thread={thread}
            notice={notice}
            onBack={() => {
              setNotice(null);
              setView("list");
            }}
          />
        )}
      </div>
      <p className="mt-4 border-t border-black/10 pt-3 text-[14px] leading-snug text-[#8A2626]">
        We will never ask you to send money by message, or for your mobile
        money PIN, password or a code sent to your phone.
      </p>
    </div>
  );
}
