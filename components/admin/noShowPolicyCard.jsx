import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../src/firebase";
import { useSiteSettings } from "../../src/siteSettings";
import { callableMessage } from "../../src/constants";
import ConfirmDialog from "./confirmDialog.jsx";

// No-show policy (functions/siteSettings.js updateNoShowPolicy):
//   waiting time     how long the patient has to join after the start (or
//                    after the doctor joined, if later); then an online
//                    call is marked a no-show automatically
//   share kept       taken off a refund when a no-show asks for one
//   reschedule fee   what a no-show pays to book a new time
// Patients see these figures in their booking, emails and the terms.
// A no-show keeps the policy it was marked under; changes apply from now on.

const callUpdate = httpsCallable(functions, "updateNoShowPolicy");

const FIELDS = [
  { key: "waitMinutes", label: "Waiting time", unit: "minutes", min: 1, max: 30, hint: "How long the patient has to join before it counts as a no-show" },
  { key: "forfeitPercent", label: "Share kept on a refund", unit: "%", min: 0, max: 100, hint: "Taken off the refund when a no-show asks for their money back" },
  { key: "rescheduleFee", label: "No-show reschedule fee", unit: "GHS", min: 0, max: 5000, hint: "What a no-show pays to book a new time (0 = free)" },
];

const parse = (value, { min, max }) => {
  const n = Number(String(value).trim());
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export default function NoShowPolicyCard() {
  const { settings } = useSiteSettings();
  const current = settings.noShow;
  const [draft, setDraft] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const shown = draft ?? Object.fromEntries(FIELDS.map((f) => [f.key, String(current[f.key])]));
  const parsed = Object.fromEntries(FIELDS.map((f) => [f.key, parse(shown[f.key], f)]));
  const valid = FIELDS.every((f) => parsed[f.key] !== null);
  const changed = FIELDS.filter((f) => parsed[f.key] !== null && parsed[f.key] !== current[f.key]);

  async function save() {
    setConfirming(false);
    setBusy(true);
    setNote(null);
    try {
      await callUpdate(parsed);
      setNote({ tone: "ok", text: "No-show policy saved. It applies to no-shows from now on." });
      setDraft(null);
    } catch (err) {
      setNote({ tone: "error", text: callableMessage(err, "We couldn't save the policy. Try again.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cp-card" aria-labelledby="cp-noshow-title">
      <header className="cp-card-head">
        <h2 id="cp-noshow-title">No-show policy</h2>
        <p>
          When the doctor is in an online call and the patient hasn't joined
          within the waiting time, the consultation is marked as a no-show
          automatically (doctors can't mark one earlier). The patient can then
          pay the reschedule fee to book a new time, or ask for a refund minus
          the share kept. Patients see these figures in their booking, emails
          and the terms.
        </p>
      </header>

      <div className="cp-price-grid">
        {FIELDS.map((f) => {
          const invalid = draft !== null && parsed[f.key] === null;
          return (
            <div className="cp-field" key={f.key}>
              <label htmlFor={`cp-noshow-${f.key}`}>{f.label}</label>
              <div className={`cp-input${invalid ? " invalid" : ""}`}>
                {f.unit === "GHS" && <span aria-hidden="true">GHS</span>}
                <input
                  id={`cp-noshow-${f.key}`}
                  type="text"
                  inputMode="numeric"
                  value={shown[f.key]}
                  disabled={busy}
                  aria-invalid={invalid}
                  onChange={(e) => {
                    setNote(null);
                    setDraft({ ...shown, [f.key]: e.target.value });
                  }}
                />
                {f.unit !== "GHS" && <span aria-hidden="true">{f.unit}</span>}
              </div>
              <p className={`cp-help${invalid ? " cp-help-error" : ""}`}>
                {invalid ? `Enter a whole number from ${f.min} to ${f.max}.` : `${f.hint}. Currently ${current[f.key]} ${f.unit}.`}
              </p>
            </div>
          );
        })}
      </div>

      {note && (
        <p role={note.tone === "error" ? "alert" : "status"} className={`cp-note cp-note-${note.tone}`}>
          {note.text}
        </p>
      )}

      <div className="cp-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !valid || changed.length === 0}
          onClick={() => setConfirming(true)}
        >
          {busy ? "Saving…" : "Review and save"}
        </button>
        {draft && !busy && (
          <button type="button" className="btn btn-outline" onClick={() => setDraft(null)}>
            Discard changes
          </button>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title="Update the no-show policy?"
          body={changed.map((f) => `${f.label}: ${current[f.key]} → ${parsed[f.key]} ${f.unit}`).join(". ") +
            ". This applies to no-shows from now on and is shown to patients straight away."}
          confirmLabel="Save policy"
          onConfirm={save}
          onClose={() => setConfirming(false)}
        />
      )}
    </section>
  );
}
