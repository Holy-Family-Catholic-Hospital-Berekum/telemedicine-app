import { useState } from "react";
import { httpsCallable } from "firebase/functions";

import { functions } from "../../src/firebase";
import { callableMessage } from "../../src/constants";
import ConfirmDialog from "./confirmDialog.jsx";

// The hospital's services listed on the home page under "Our services"
// (functions/siteSettings.js updateHospitalServices, audited). Admins add,
// remove and reorder names here, then save the whole list at once.
// `current` comes from the Control Panel's live siteSettings/public read.

const callUpdate = httpsCallable(functions, "updateHospitalServices");
const MAX = 40;

export default function ServicesCard({ current }) {
  const [draft, setDraft] = useState(null); // null = follow the saved list
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const list = draft ?? current;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(current);
  const clean = name.replace(/\s+/g, " ").trim();
  const duplicate = list.some((s) => s.toLowerCase() === clean.toLowerCase());
  const canAdd = clean.length >= 2 && clean.length <= 60 && !duplicate && list.length < MAX;

  function change(next) {
    setNote(null);
    setDraft(next);
  }

  function add(e) {
    e.preventDefault();
    if (!canAdd) return;
    change([...list, clean]);
    setName("");
  }

  function move(i, by) {
    const next = [...list];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item);
    change(next);
  }

  async function save() {
    setConfirming(false);
    setBusy(true);
    setNote(null);
    try {
      await callUpdate({ services: list });
      setNote({ tone: "ok", text: "Services saved. The home page shows them now." });
      setDraft(null);
    } catch (err) {
      setNote({ tone: "error", text: callableMessage(err, "We couldn't save the services. Try again.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cp-card" aria-labelledby="cp-services-title">
      <header className="cp-card-head">
        <h2 id="cp-services-title">Hospital services</h2>
        <p>
          Listed on the home page under "Our services". Add or remove a service,
          change the order with the arrows, then save.
        </p>
      </header>

      {list.length === 0 ? (
        <p className="cp-help">No services yet. The section is hidden until you add one.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
          {list.map((s, i) => (
            <li
              key={s}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", border: "1px solid var(--color-border)", borderRadius: 8 }}
            >
              <span style={{ flex: 1 }}>{s}</span>
              <button className="btn btn-outline" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${s} up`}>
                ↑
              </button>
              <button className="btn btn-outline" disabled={busy || i === list.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${s} down`}>
                ↓
              </button>
              <button
                className="btn btn-outline danger"
                disabled={busy}
                onClick={() => change(list.filter((x) => x !== s))}
                aria-label={`Remove ${s}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <div className="cp-input" style={{ flex: 1, minWidth: 220 }}>
          <input
            aria-label="New service"
            value={name}
            maxLength={60}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Physiotherapy"
          />
        </div>
        <button type="submit" className="btn btn-outline" disabled={busy || !canAdd}>
          Add service
        </button>
      </form>
      {duplicate && clean && <p className="cp-help cp-help-error">That service is already in the list.</p>}

      {note && (
        <p role={note.tone === "error" ? "alert" : "status"} className={`cp-note cp-note-${note.tone}`}>
          {note.text}
        </p>
      )}

      <div className="cp-actions">
        <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={() => setConfirming(true)}>
          {busy ? "Saving…" : "Save services"}
        </button>
        {dirty && !busy && (
          <button type="button" className="btn btn-outline" onClick={() => change(null)}>
            Discard changes
          </button>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title="Save the services list?"
          body={`The home page will list ${list.length} service${list.length === 1 ? "" : "s"}: ${list.join(", ")}.`}
          confirmLabel="Save"
          onConfirm={save}
          onClose={() => setConfirming(false)}
        />
      )}
    </section>
  );
}
