import { useState } from "react";
import { httpsCallable } from "firebase/functions";

import { functions } from "../../src/firebase";
import { callableMessage } from "../../src/constants";
import ConfirmDialog from "./confirmDialog.jsx";

// Whether patients pay online when they book a visit AT THE HOSPITAL
// (functions/siteSettings.js updateInPersonPayment). Off: booking a
// hospital visit is free and the patient pays at the hospital; each
// patient can have one open hospital visit at a time. Video calls are
// always paid online. Audited. `required` comes from the Control Panel's
// live siteSettings/public read.

const callUpdate = httpsCallable(functions, "updateInPersonPayment");

export default function InPersonPaymentCard({ required }) {
  const [confirming, setConfirming] = useState(null); // target value
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  async function apply(next) {
    setConfirming(null);
    setBusy(true);
    setNote(null);
    try {
      await callUpdate({ required: next });
      setNote({
        tone: "ok",
        text: next
          ? "Patients now pay online when they book a hospital visit."
          : "Booking a hospital visit is now free. Patients pay at the hospital.",
      });
    } catch (err) {
      setNote({ tone: "error", text: callableMessage(err, "Couldn't change the setting.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cp-card" aria-labelledby="cp-in-person-pay-title">
      <header className="cp-card-head">
        <h2 id="cp-in-person-pay-title">Payment for hospital visits</h2>
        <p>
          When on, patients pay online (mobile money) when they book a visit at
          the hospital, like video calls. When off, booking a hospital visit is
          free and the patient pays at the hospital; each patient can then have
          one open hospital visit at a time. Video calls are always paid
          online.
        </p>
      </header>

      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span className={`status-pill ${required ? "confirmed" : "rejected"}`} role="status">
          {required ? "Pay online when booking" : "Pay at the hospital"}
        </span>
        <button
          className={`btn ${required ? "btn-outline" : "btn-primary"}`}
          disabled={busy}
          onClick={() => setConfirming(!required)}
        >
          {busy ? "Saving…" : required ? "Let patients pay at the hospital" : "Ask patients to pay online"}
        </button>
      </div>

      {note && (
        <p role={note.tone === "error" ? "alert" : "status"} className={`cp-note cp-note-${note.tone}`}>
          {note.text}
        </p>
      )}

      {confirming !== null && (
        <ConfirmDialog
          title={confirming ? "Ask patients to pay online for hospital visits?" : "Let patients pay at the hospital?"}
          body={
            confirming
              ? "New hospital-visit bookings will need payment by mobile money before they are confirmed. Visits already booked to pay at the hospital stay that way."
              : "New hospital-visit bookings will be free to book; patients pay at the hospital when they come. Each patient can have one open hospital visit at a time."
          }
          confirmLabel={confirming ? "Ask to pay online" : "Pay at the hospital"}
          onConfirm={() => apply(confirming)}
          onClose={() => setConfirming(null)}
        />
      )}
    </section>
  );
}
