import { useState } from "react";
import { httpsCallable } from "firebase/functions";

import { functions } from "../../src/firebase";
import { callableMessage } from "../../src/constants";
import ConfirmDialog from "./confirmDialog.jsx";

// Whether patients may choose a specific doctor when booking. Off: the
// booking page hides the doctor picker, the home page hides "Book this
// doctor", and the server ignores any doctor sent, so staff assign every
// booking. Open slots keep their doctor (an admin set them up). Audited.
// `enabled` comes from the Control Panel's live siteSettings/public read.

const callUpdate = httpsCallable(functions, "updateDoctorSelection");

export default function DoctorSelectionCard({ enabled }) {
  const [confirming, setConfirming] = useState(null); // target value
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  async function apply(next) {
    setConfirming(null);
    setBusy(true);
    setNote(null);
    try {
      await callUpdate({ enabled: next });
      setNote({
        tone: "ok",
        text: next
          ? "Patients can now choose their doctor when booking."
          : "Patients can no longer choose a doctor. Staff assign every new booking.",
      });
    } catch (err) {
      setNote({ tone: "error", text: callableMessage(err, "Couldn't change the setting.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cp-card" aria-labelledby="cp-doctor-choice-title">
      <header className="cp-card-head">
        <h2 id="cp-doctor-choice-title">Patients choosing a doctor</h2>
        <p>
          When on, patients can pick a specific doctor on the booking page and
          use "Book this doctor" on the home page. When off, both are hidden
          and staff assign a doctor to every booking.
        </p>
      </header>

      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span className={`status-pill ${enabled ? "confirmed" : "rejected"}`} role="status">
          {enabled ? "Doctor choice ON" : "Doctor choice OFF"}
        </span>
        <button
          className={`btn ${enabled ? "btn-outline danger" : "btn-primary"}`}
          disabled={busy}
          onClick={() => setConfirming(!enabled)}
        >
          {busy ? "Saving…" : enabled ? "Turn doctor choice off" : "Turn doctor choice on"}
        </button>
      </div>

      {note && (
        <p role={note.tone === "error" ? "alert" : "status"} className={`cp-note cp-note-${note.tone}`}>
          {note.text}
        </p>
      )}

      {confirming !== null && (
        <ConfirmDialog
          title={confirming ? "Let patients choose their doctor?" : "Stop patients choosing their doctor?"}
          body={
            confirming
              ? "The doctor picker and the \"Book this doctor\" buttons will show again."
              : "The doctor picker and the \"Book this doctor\" buttons will be hidden, and staff will assign a doctor to every new booking. Existing bookings keep any doctor already requested."
          }
          confirmLabel={confirming ? "Turn on" : "Turn off"}
          tone={confirming ? undefined : "danger"}
          onConfirm={() => apply(confirming)}
          onClose={() => setConfirming(null)}
        />
      )}
    </section>
  );
}
