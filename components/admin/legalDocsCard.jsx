// legalDocsCard.jsx
//
// Control panel card for editing the public Terms of service and Privacy
// policy. Saving goes through the `updateLegalDocument` callable, which checks
// the caller is an admin, validates the text, keeps the previous version and
// writes an audit entry. This screen cannot write to Firestore directly.

import { useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";

import { db, functions } from "../../src/firebase";
import { formatDateTime } from "../../src/constants";
import { useLegalDoc, LEGAL_LIMITS } from "../../src/legalDocs";
import { DEFAULT_LEGAL } from "./legalDefaults";
import ConfirmDialog from "./confirmDialog.jsx";

const callUpdateLegal = httpsCallable(functions, "updateLegalDocument");

const DOCS = [
  { id: "terms", label: "Terms of service", path: "/terms" },
  { id: "privacy", label: "Privacy policy", path: "/privacy" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function withIds(sections) {
  const used = new Set(sections.map((s) => s.id).filter(Boolean));
  return sections.map((s, i) => {
    if (s.id) return s;
    const base = slugify(s.title) || `section-${i + 1}`;
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    return { ...s, id };
  });
}

function friendlyError(err, fallback) {
  const code = err?.code || "";
  if (code === "functions/permission-denied") {
    return "Your account isn't allowed to make this change.";
  }
  if (code === "functions/unauthenticated") {
    return "Your session has expired. Sign in again to continue.";
  }
  if (code.startsWith("functions/") && code !== "functions/internal" && err.message) {
    return err.message;
  }
  return fallback;
}

// The part of a draft that is actually saved.
const project = (d) => ({
  intro: d.intro,
  contactEmail: d.contactEmail,
  sections: d.sections.map((s) => ({ id: s.id, title: s.title, body: s.body })),
});

function LegalEditor({ meta }) {
  const { loading, content } = useLegalDoc(meta.id);
  const [draft, setDraft] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const seq = useRef(0);

  if (loading) {
    return (
      <p className="cp-loading" role="status">
        Loading…
      </p>
    );
  }

  const saved = {
    intro: content.intro,
    contactEmail: content.contactEmail,
    sections: content.sections.map((s) => ({ ...s, key: s.id })),
  };
  const shown = draft ?? saved;
  const dirty = JSON.stringify(project(shown)) !== JSON.stringify(project(saved));

  const edit = (patch) => {
    setNote(null);
    setDraft({ ...shown, ...patch });
  };
  const editSection = (key, patch) =>
    edit({
      sections: shown.sections.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    });
  const move = (i, delta) => {
    const next = [...shown.sections];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    edit({ sections: next });
  };
  // The wording built into the app (components/admin/legalDefaults.js),
  // kept up to date with how the app works. Loads it into the draft for an
  // admin to review and publish; replaces a stale saved version.
  const builtIn = DEFAULT_LEGAL[meta.id];
  const builtInDraft = {
    intro: builtIn.intro,
    contactEmail: builtIn.contactEmail,
    sections: builtIn.sections.map((s) => ({ id: s.id, title: s.title, body: s.body, key: `builtin-${s.id}` })),
  };
  const matchesBuiltIn = JSON.stringify(project(shown)) === JSON.stringify(project(builtInDraft));
  const loadBuiltIn = () => {
    setDraft(builtInDraft);
    setNote({
      tone: "ok",
      text: "The built-in text is loaded below. Check it, then choose Review and save to publish it.",
    });
  };
  const remove = (key) =>
    edit({ sections: shown.sections.filter((s) => s.key !== key) });
  const add = () =>
    edit({
      sections: [
        ...shown.sections,
        { key: `new-${seq.current++}`, id: "", title: "", body: "" },
      ],
    });

  function problem() {
    if (!EMAIL_RE.test(shown.contactEmail.trim())) return "Enter a valid contact email address.";
    if (!shown.intro.trim()) return "The introduction can't be empty.";
    if (shown.sections.length === 0) return "Keep at least one section.";
    if (shown.sections.length > LEGAL_LIMITS.sections) {
      return `The limit is ${LEGAL_LIMITS.sections} sections.`;
    }
    const i = shown.sections.findIndex((s) => !s.title.trim() || !s.body.trim());
    if (i !== -1) return `Section ${i + 1} needs a title and some text.`;
    return null;
  }

  function review() {
    const p = problem();
    if (p) {
      setNote({ tone: "error", text: p });
      return;
    }
    setConfirming(true);
  }

  async function save() {
    setConfirming(false);
    setBusy(true);
    setNote(null);
    const payload = {
      docId: meta.id,
      intro: shown.intro.trim(),
      contactEmail: shown.contactEmail.trim(),
      sections: withIds(
        shown.sections.map((s) => ({
          id: s.id,
          title: s.title.trim(),
          body: s.body.trim(),
        })),
      ),
    };
    try {
      await callUpdateLegal(payload);
      // Keep showing what was saved until the live snapshot catches up.
      setDraft({
        intro: payload.intro,
        contactEmail: payload.contactEmail,
        sections: payload.sections.map((s) => ({ ...s, key: s.id })),
      });
      setNote({ tone: "ok", text: `Saved. The ${meta.label.toLowerCase()} page is updated.` });
    } catch (err) {
      setNote({
        tone: "error",
        text: friendlyError(err, "We couldn't save that. Check your connection and try again."),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="cp-help">
        Last updated {content.lastUpdated}
        {content.version > 0 ? ` (version ${content.version})` : " (built-in text)"}.{" "}
        <a href={meta.path} target="_blank" rel="noreferrer">
          View live page
        </a>
      </p>

      <div className="cp-field">
        <label htmlFor={`cp-${meta.id}-intro`}>Introduction</label>
        <textarea
          id={`cp-${meta.id}-intro`}
          className="cp-textarea"
          rows={3}
          value={shown.intro}
          maxLength={LEGAL_LIMITS.intro}
          onChange={(e) => edit({ intro: e.target.value })}
          disabled={busy}
        />
      </div>

      <div className="cp-field">
        <label htmlFor={`cp-${meta.id}-email`}>Contact email shown on the page</label>
        <input
          id={`cp-${meta.id}-email`}
          className="cp-text"
          type="email"
          value={shown.contactEmail}
          onChange={(e) => edit({ contactEmail: e.target.value })}
          disabled={busy}
        />
        <p className="cp-help">
          Use a monitored address. The contact section is added at the end
          automatically.
        </p>
      </div>

      <p className="cp-help">
        Writing text: leave a blank line to start a new paragraph, start a line
        with “- ” for a bullet, and write [link text](/privacy) for a link.
        Section numbers are added for you.
      </p>

      {shown.sections.map((s, i) => (
        <div className="cp-legal-section" key={s.key}>
          <div className="cp-field">
            <label htmlFor={`cp-${meta.id}-t-${s.key}`}>Section {i + 1} title</label>
            <input
              id={`cp-${meta.id}-t-${s.key}`}
              className="cp-text"
              type="text"
              value={s.title}
              maxLength={LEGAL_LIMITS.title}
              onChange={(e) => editSection(s.key, { title: e.target.value })}
              disabled={busy}
            />
          </div>
          <div className="cp-field">
            <label htmlFor={`cp-${meta.id}-b-${s.key}`}>Text</label>
            <textarea
              id={`cp-${meta.id}-b-${s.key}`}
              className="cp-textarea"
              rows={Math.min(14, Math.max(4, s.body.split("\n").length + 1))}
              value={s.body}
              maxLength={LEGAL_LIMITS.body}
              onChange={(e) => editSection(s.key, { body: e.target.value })}
              disabled={busy}
            />
          </div>
          <div className="cp-actions">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => move(i, -1)}
              disabled={busy || i === 0}
            >
              Move up
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => move(i, 1)}
              disabled={busy || i === shown.sections.length - 1}
            >
              Move down
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => remove(s.key)}
              disabled={busy}
            >
              Remove section
            </button>
          </div>
        </div>
      ))}

      <div className="cp-actions">
        <button
          type="button"
          className="btn btn-outline"
          onClick={add}
          disabled={busy || shown.sections.length >= LEGAL_LIMITS.sections}
        >
          Add section
        </button>
        {!matchesBuiltIn && (
          <button type="button" className="btn btn-outline" onClick={loadBuiltIn} disabled={busy}>
            Start from the built-in text
          </button>
        )}
      </div>

      {note && (
        <p
          role={note.tone === "error" ? "alert" : "status"}
          className={`cp-note cp-note-${note.tone}`}
        >
          {note.text}
        </p>
      )}

      <div className="cp-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={review}
          disabled={busy || !dirty}
        >
          {busy ? "Saving…" : "Review and save"}
        </button>
        {dirty && !busy && (
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              setDraft(null);
              setNote(null);
            }}
          >
            Discard changes
          </button>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title={`Publish the ${meta.label.toLowerCase()}?`}
          body="The public page will show this text straight away and the “Last updated” date will change. Patients who already booked agreed to the earlier wording, and this does not notify them."
          confirmLabel="Publish"
          onConfirm={save}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

/**
 * Earlier wording, kept for reference (functions/legalDocs.js archives the
 * text that was live before every save; nothing is deleted). Admins can
 * read it (firestore.rules legalDocs/{id}/versions); loaded on demand.
 */
function VersionHistory({ docId }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [shown, setShown] = useState(null); // id of the version being read

  async function load() {
    setOpen(true);
    if (items) return;
    try {
      const snap = await getDocs(
        query(collection(db, "legalDocs", docId, "versions"), orderBy("archivedAt", "desc"), limit(50)),
      );
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch {
      setError("Couldn't load the previous versions.");
    }
  }

  return (
    <div className="cp-history">
      {!open ? (
        <button type="button" className="btn btn-outline" onClick={load}>
          Show previous versions
        </button>
      ) : (
        <>
          <h3 className="cp-history-title">Previous versions</h3>
          {error && <p className="cp-note cp-note-error">{error}</p>}
          {!items && !error && <p className="cp-loading">Loading…</p>}
          {items?.length === 0 && (
            <p className="cp-note">No earlier versions yet: the text has only been published once (or not yet).</p>
          )}
          {items?.length > 0 && (
            <ul className="cp-history-list">
              {items.map((v) => (
                <li key={v.id}>
                  <div className="cp-history-row">
                    <span>
                      <strong>{v.preLaunch ? "Pre-launch draft (version 1)" : `Version ${v.version}`}</strong>
                      {" · "}published {formatDateTime(v.updatedAt?.toDate?.())}, replaced{" "}
                      {formatDateTime(v.archivedAt?.toDate?.())}
                    </span>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => setShown(shown === v.id ? null : v.id)}
                    >
                      {shown === v.id ? "Hide" : "Read"}
                    </button>
                  </div>
                  {shown === v.id && (
                    <div className="cp-history-text">
                      <p>{v.intro}</p>
                      {(v.sections || []).map((sec) => (
                        <div key={sec.id}>
                          <h4>{sec.title}</h4>
                          <p style={{ whiteSpace: "pre-wrap" }}>{sec.body}</p>
                        </div>
                      ))}
                      <p className="cp-note">Contact: {v.contactEmail}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
            Hide previous versions
          </button>
        </>
      )}
    </div>
  );
}

export default function LegalDocsCard() {
  const [active, setActive] = useState("terms");

  return (
    <section className="cp-card" aria-labelledby="cp-legal-title">
      <header className="cp-card-head">
        <h2 id="cp-legal-title">Terms and privacy policy</h2>
        <p>
          The legal pages linked from booking and sign-up. Changing the text
          here does not change how the system behaves, so make sure it stays
          true to what the platform actually does.
        </p>
      </header>

      <div className="cp-actions" role="tablist" aria-label="Legal page">
        {DOCS.map((d) => (
          <button
            key={d.id}
            type="button"
            role="tab"
            aria-selected={active === d.id}
            className={`btn ${active === d.id ? "btn-primary" : "btn-outline"}`}
            onClick={() => setActive(d.id)}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Both editors stay mounted so unsaved edits survive switching tabs. */}
      {DOCS.map((d) => (
        <div key={d.id} hidden={active !== d.id}>
          <LegalEditor meta={d} />
          <VersionHistory docId={d.id} />
        </div>
      ))}
    </section>
  );
}
