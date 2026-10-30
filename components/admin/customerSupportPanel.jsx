import { useEffect, useMemo, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query } from "firebase/firestore";

import { db } from "../../src/firebase";
import { MODE_LABELS, TYPE_LABELS, formatDateTime } from "../../src/constants";
import { SUPPORT_TOPICS, MESSAGE_MAX, MESSAGES_PER_THREAD } from "../patient/support/supportHours.js";
import { useFirestoreCollection } from "./hooks/useFirestoreCollection.js";
import { useWindowedCollection } from "./hooks/useWindowedCollection.js";
import { actorLabel } from "./actorName.js";
import { IconSearch } from "./icons.jsx";
import { LoadOlder } from "../shared/pagination.jsx";

// Customer support tab: patients' messages from the Help button
// (functions/support.js). Replies reach the patient in the app and by
// email, signed "Holy Family support"; who wrote each one is kept for
// admins only (supportStaff) and in the audit log. Messages are shown as
// plain text (never HTML, links not clickable). Closed conversations are
// deleted 30 days after closing; answered ones close themselves after 7
// days without a reply from the patient.

const WINDOW = 200;
const threadsWindow = (n) =>
  query(collection(db, "supportThreads"), orderBy("lastMessageAt", "desc"), limit(n));

const FILTERS = {
  waiting: "Waiting for us",
  answered: "Answered",
  closed: "Closed",
  all: "All",
};

const ago = (date) => {
  if (!date) return "";
  const mins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
};

function Conversation({ thread, names, currentUid, callAdmin }) {
  const messagesQuery = useMemo(
    () => query(collection(db, "supportThreads", thread.id, "messages"), orderBy("at", "asc"), limit(100)),
    [thread.id],
  );
  const { data: messages } = useFirestoreCollection(messagesQuery);
  const [staff, setStaff] = useState(null);
  useEffect(
    () => onSnapshot(doc(db, "supportStaff", thread.id), (snap) => setStaff(snap.data() || {}), () => setStaff({})),
    [thread.id],
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(null); // "reply" | "claim" | "close"

  const run = async (what, name, payload, after) => {
    setBusy(what);
    try {
      await callAdmin(name, payload);
      after?.();
    } catch {
      // callAdmin shows the error banner
    } finally {
      setBusy(null);
    }
  };

  const handler = staff?.handledBy?.uid;
  const mine = handler === currentUid;
  const b = thread.booking;
  const full = (thread.messageCount || 0) >= MESSAGES_PER_THREAD;

  return (
    <div className="support-thread">
      <div className="support-thread-head">
        <div>
          <h3>{SUPPORT_TOPICS[thread.topic] ?? "Message"}</h3>
          <div className="admin-cell-sub">
            {thread.patientName || "Patient"} · {thread.patientEmail || "no email"}
          </div>
          {b && (
            <div className="admin-cell-sub">
              Booking: <span className="code-chip">{b.consultationId || b.id}</span>{" "}
              {[TYPE_LABELS[b.type], MODE_LABELS[b.mode], b.scheduledTime ? formatDateTime(b.scheduledTime) : "not scheduled yet"]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}
          <div className="admin-cell-sub">
            {handler
              ? `Handled by ${mine ? "you" : actorLabel(handler, names).name}`
              : "Nobody is handling this yet"}
          </div>
        </div>
        <div className="admin-row-actions">
          {!mine ? (
            <button
              className="btn btn-outline"
              disabled={busy !== null}
              onClick={() => run("claim", "claimSupportThread", { threadId: thread.id })}
            >
              {handler ? "Take over" : "I'm handling this"}
            </button>
          ) : (
            <button
              className="btn btn-outline"
              disabled={busy !== null}
              onClick={() => run("claim", "claimSupportThread", { threadId: thread.id, release: true })}
            >
              Let it go
            </button>
          )}
          {thread.status !== "closed" && (
            <button
              className="btn btn-outline"
              disabled={busy !== null}
              onClick={() => run("close", "closeSupportThread", { threadId: thread.id })}
            >
              Close
            </button>
          )}
        </div>
      </div>

      <ol className="support-messages">
        {messages.map((m) => (
          <li key={m.id} className={m.from === "support" ? "from-support" : "from-patient"}>
            <div className="support-bubble">{m.text}</div>
            <div className="admin-cell-sub">
              {m.from === "support"
                ? actorLabel(staff?.replies?.[m.id], names).name
                : thread.patientName || "Patient"}
              {" · "}
              {formatDateTime(m.at)}
            </div>
          </li>
        ))}
      </ol>

      {full ? (
        <div className="admin-empty">This conversation has reached its message limit. The patient can start a new one.</div>
      ) : (
        <form
          className="support-reply"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim().length >= 2) {
              run("reply", "replySupportMessage", { threadId: thread.id, text }, () => setText(""));
            }
          }}
        >
          <label htmlFor="support-reply-text" className="admin-cell-sub">
            Reply as Holy Family support. The patient sees it here and gets it by email. Never ask for money,
            a PIN, a password or a code, and don't give medical advice.
          </label>
          <textarea
            id="support-reply-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MESSAGE_MAX}
            rows={4}
          />
          <div className="admin-row-actions">
            <span className="admin-cell-sub">{MESSAGE_MAX - text.length} characters left</span>
            <button type="submit" className="btn btn-primary" disabled={busy !== null || text.trim().length < 2}>
              {busy === "reply" ? "Sending…" : thread.status === "closed" ? "Reply and reopen" : "Send reply"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function CustomerSupportPanel({ callAdmin, names, currentUid, waitingCount }) {
  const win = useWindowedCollection(threadsWindow, WINDOW);
  const [filter, setFilter] = useState("waiting");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = win.data
      .filter((t) => filter === "all" || t.status === filter)
      .filter((t) => !q || [t.patientName, t.patientEmail, t.preview].join(" ").toLowerCase().includes(q));
    // Waiting: oldest first, so nobody waits longest.
    return filter === "waiting"
      ? [...list].sort((a, b) => (a.waitingSince ?? a.lastMessageAt) - (b.waitingSince ?? b.lastMessageAt))
      : list;
  }, [win.data, filter, search]);
  const selected = win.data.find((t) => t.id === selectedId) || null;

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <div>
          <h2>Customer support</h2>
          <p>
            Messages from signed-in patients. Office hours: Monday to Friday, 8:00 am to 5:00 pm. Patients
            who write outside them are emailed that we'll reply when we open.
          </p>
        </div>
        <div className="admin-search">
          <IconSearch size={15} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by patient or message" />
        </div>
      </div>
      <div className="admin-subtabs">
        {Object.entries(FILTERS).map(([key, label]) => (
          <button
            key={key}
            className={`admin-subtab${filter === key ? " active" : ""}`}
            onClick={() => setFilter(key)}
          >
            {label}
            {key === "waiting" ? ` (${waitingCount})` : ""}
          </button>
        ))}
      </div>

      {win.error ? (
        <div className="admin-empty">Couldn't load support messages. Check your connection and try again.</div>
      ) : (
        <div className="support-layout">
          <div>
            {rows.length === 0 ? (
              <div className="admin-empty">{win.loading && win.loaded === 0 ? "Loading…" : "No conversations here."}</div>
            ) : (
              <ul className="support-list">
                {rows.map((t) => (
                  <li key={t.id}>
                    <button className={t.id === selectedId ? "active" : ""} onClick={() => setSelectedId(t.id)}>
                      <span className="admin-cell-name">{t.patientName || "Patient"}</span>
                      <span className="admin-cell-sub">
                        {SUPPORT_TOPICS[t.topic] ?? "Message"}
                        {t.status === "waiting" ? ` · waiting ${ago(t.waitingSince ?? t.lastMessageAt)}` : ""}
                      </span>
                      <span className="admin-cell-sub support-preview">
                        {t.lastFrom === "support" ? "Support: " : ""}
                        {t.preview}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <LoadOlder
              canLoadMore={win.canLoadMore}
              loading={win.loading}
              onLoadMore={win.loadMore}
              loaded={win.loaded}
              noun="conversations"
            />
          </div>
          {selected ? (
            <Conversation
              key={selected.id}
              thread={selected}
              names={names}
              currentUid={currentUid}
              callAdmin={callAdmin}
            />
          ) : (
            <div className="admin-empty">Choose a conversation to read and reply.</div>
          )}
        </div>
      )}
    </section>
  );
}
