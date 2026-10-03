import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db, functions } from "../../src/firebase";
import { callableMessage, formatDateTime } from "../../src/constants";
import ConfirmDialog from "./confirmDialog.jsx";

// The one control over call recording. While it's on, every online call
// that starts is recorded automatically; doctors and patients can't turn it
// off. The server snapshots the switch when each call starts, so turning it
// off doesn't cut a recording already in progress, and turning it on
// applies to calls that start afterwards. Each change is audited.

const callSetRecording = httpsCallable(functions, "setCallRecordingEnabled");

export default function RecordingSwitchCard() {
  const [state, setState] = useState({ loading: true, enabled: false, updatedAt: null });
  const [loadError, setLoadError] = useState(null);
  const [confirming, setConfirming] = useState(null); // true | false (target)
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  useEffect(
    () =>
      onSnapshot(
        doc(db, "systemSettings", "features"),
        (snap) => {
          const data = snap.exists() ? snap.data() : {};
          setState({
            loading: false,
            enabled: data.callRecordingEnabled === true,
            updatedAt: data.updatedAt ?? null,
          });
        },
        (err) => setLoadError(err),
      ),
    [],
  );

  async function apply(enabled) {
    setConfirming(null);
    setBusy(true);
    setNote(null);
    try {
      await callSetRecording({ enabled });
      setNote({
        tone: "ok",
        text: enabled
          ? "Recording is on. Calls that start from now on are recorded."
          : "Recording is off. Calls already being recorded finish recording.",
      });
    } catch (err) {
      setNote({ tone: "error", text: callableMessage(err, "Couldn't change the setting.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cp-card" aria-labelledby="cp-recording-title">
      <header className="cp-card-head">
        <h2 id="cp-recording-title">Call recording</h2>
        <p>
          When on, every online consultation is recorded automatically (video
          and audio) and both the doctor and the patient see a REC sign.
          Doctors and patients can't switch it off. Recordings are listed
          under Call Recordings.
        </p>
      </header>

      {loadError ? (
        <p role="alert" className="cp-note cp-note-error">
          Couldn't load the current setting. Refresh the page.
        </p>
      ) : state.loading ? (
        <p className="cp-loading" role="status">
          Loading…
        </p>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <span
            className={`status-pill ${state.enabled ? "confirmed" : "rejected"}`}
            role="status"
          >
            {state.enabled ? "Recording ON" : "Recording OFF"}
          </span>
          {state.updatedAt && (
            <span className="admin-cell-sub">
              Last changed {formatDateTime(state.updatedAt)}
            </span>
          )}
          <button
            className={`btn ${state.enabled ? "btn-outline danger" : "btn-primary"}`}
            disabled={busy}
            onClick={() => setConfirming(!state.enabled)}
          >
            {busy ? "Saving…" : state.enabled ? "Turn recording off" : "Turn recording on"}
          </button>
        </div>
      )}

      {note && (
        <p role={note.tone === "error" ? "alert" : "status"} className={`cp-note cp-note-${note.tone}`}>
          {note.text}
        </p>
      )}

      {confirming !== null && (
        <ConfirmDialog
          title={confirming ? "Turn call recording on?" : "Turn call recording off?"}
          body={
            confirming
              ? "Every online consultation that starts from now on will be recorded, until recording is turned off."
              : "Online consultations that start from now on won't be recorded. Calls already being recorded will finish recording."
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
