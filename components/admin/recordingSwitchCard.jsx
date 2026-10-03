import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db, functions } from "../../src/firebase";
import { callableMessage, formatDateTime } from "../../src/constants";
import ConfirmDialog from "./confirmDialog.jsx";

// The one control over call recording: Off, Video (picture and both
// voices) or Audio only (both voices). While it isn't off, every online
// call that starts is recorded automatically in that mode; doctors and
// patients can't change it. The server snapshots the mode when each call
// starts, so a change applies to calls that start afterwards and never
// cuts a recording already in progress. Each change is audited.

const callSetMode = httpsCallable(functions, "setCallRecordingMode");

const MODES = [
  { key: "off", label: "Off", help: "Calls are not recorded." },
  { key: "video", label: "Video", help: "Picture and sound of both people." },
  { key: "audio", label: "Audio only", help: "Sound of both people, no picture." },
];
const LABEL = { off: "Recording OFF", video: "Recording VIDEO", audio: "Recording AUDIO ONLY" };

function modeOf(data) {
  if (["off", "video", "audio"].includes(data?.callRecordingMode)) return data.callRecordingMode;
  return data?.callRecordingEnabled === true ? "video" : "off";
}

export default function RecordingSwitchCard() {
  const [state, setState] = useState({ loading: true, mode: "off", updatedAt: null });
  const [loadError, setLoadError] = useState(null);
  const [confirming, setConfirming] = useState(null); // target mode
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  useEffect(
    () =>
      onSnapshot(
        doc(db, "systemSettings", "features"),
        (snap) => {
          const data = snap.exists() ? snap.data() : {};
          setState({ loading: false, mode: modeOf(data), updatedAt: data.updatedAt ?? null });
        },
        (err) => setLoadError(err),
      ),
    [],
  );

  async function apply(mode) {
    setConfirming(null);
    setBusy(true);
    setNote(null);
    try {
      await callSetMode({ mode });
      setNote({
        tone: "ok",
        text:
          mode === "off"
            ? "Recording is off. Calls already being recorded finish recording."
            : `Calls that start from now on are recorded (${mode === "audio" ? "audio only" : "video and sound"}).`,
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
          Choose how online consultations are recorded. While recording is on,
          every call is recorded automatically and both the doctor and the
          patient see a REC sign. Doctors and patients can't change it.
          Recordings are listed under Call Recordings.
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
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span
              className={`status-pill ${state.mode === "off" ? "rejected" : "confirmed"}`}
              role="status"
            >
              {LABEL[state.mode]}
            </span>
            {state.updatedAt && (
              <span className="admin-cell-sub">Last changed {formatDateTime(state.updatedAt)}</span>
            )}
          </div>
          <div
            role="radiogroup"
            aria-label="Recording mode"
            style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}
          >
            {MODES.map((m) => {
              const active = state.mode === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={busy || active}
                  onClick={() => setConfirming(m.key)}
                  className={`btn ${active ? "btn-primary" : "btn-outline"}`}
                  title={m.help}
                  style={{ flexDirection: "column", alignItems: "flex-start", minWidth: 150 }}
                >
                  <strong>{m.label}</strong>
                  <span style={{ fontSize: 12, opacity: 0.8, fontWeight: 400 }}>{m.help}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {note && (
        <p role={note.tone === "error" ? "alert" : "status"} className={`cp-note cp-note-${note.tone}`}>
          {note.text}
        </p>
      )}

      {confirming && (
        <ConfirmDialog
          title={
            confirming === "off"
              ? "Turn call recording off?"
              : `Record calls as ${confirming === "audio" ? "audio only" : "video"}?`
          }
          body={
            confirming === "off"
              ? "Online consultations that start from now on won't be recorded. Calls already being recorded will finish recording."
              : `Every online consultation that starts from now on will be recorded (${
                  confirming === "audio" ? "sound only, no picture" : "picture and sound"
                }) until you change this.`
          }
          confirmLabel={confirming === "off" ? "Turn off" : "Confirm"}
          tone={confirming === "off" ? "danger" : undefined}
          onConfirm={() => apply(confirming)}
          onClose={() => setConfirming(null)}
        />
      )}
    </section>
  );
}
