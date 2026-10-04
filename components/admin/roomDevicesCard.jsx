import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db, functions } from "../../src/firebase";
import { callableMessage, formatDateTime } from "../../src/constants";
import { getRoomDevice, saveRoomDevice, forgetRoomDevice } from "../../src/roomDevice";
import ConfirmDialog from "./confirmDialog.jsx";

// Telemedicine room computers. Doctors can only start video consultations
// from a computer registered here. Register a computer by opening this
// screen ON that computer (signed in as an admin) and pressing Register:
// its browser keeps a device key, and from then on any doctor who signs in
// there starts calls with one click. Doctors never need the consultation
// ID. Remove a computer that is lost, replaced or no longer in the room.

const callRegister = httpsCallable(functions, "registerRoomDevice");
const callRevoke = httpsCallable(functions, "revokeRoomDevice");

export default function RoomDevicesCard() {
  const [devices, setDevices] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [thisDevice, setThisDevice] = useState(() => getRoomDevice());
  const [label, setLabel] = useState("Telemedicine room");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [revoking, setRevoking] = useState(null); // device

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "roomDevices"), orderBy("createdAt", "desc")),
        (snap) => setDevices(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (err) => setLoadError(err),
      ),
    [],
  );

  // A key for a device that has been removed is useless: forget it.
  const thisRecord = devices?.find((d) => d.id === thisDevice?.id);
  const thisActive = thisRecord?.status === "active";

  async function register(e) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const { data } = await callRegister({ label: label.trim() });
      const device = { id: data.deviceId, key: data.key, label: label.trim() };
      if (!saveRoomDevice(device)) {
        await callRevoke({ deviceId: data.deviceId }).catch(() => {});
        throw new Error("This browser won't store the device key. Allow site data and try again.");
      }
      setThisDevice(device);
      setNote({ tone: "ok", text: "This computer is now a telemedicine room computer. Doctors who sign in here can start their video calls." });
    } catch (err) {
      setNote({ tone: "error", text: callableMessage(err, err.message || "Couldn't register this computer.") });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(device) {
    setRevoking(null);
    setBusy(true);
    setNote(null);
    try {
      await callRevoke({ deviceId: device.id });
      if (device.id === thisDevice?.id) {
        forgetRoomDevice();
        setThisDevice(null);
      }
      setNote({ tone: "ok", text: `"${device.label}" can no longer start video calls.` });
    } catch (err) {
      setNote({ tone: "error", text: callableMessage(err, "Couldn't remove that computer.") });
    } finally {
      setBusy(false);
    }
  }

  const active = (devices ?? []).filter((d) => d.status === "active");

  return (
    <section className="cp-card" aria-labelledby="cp-room-title">
      <header className="cp-card-head">
        <h2 id="cp-room-title">Telemedicine room computers</h2>
        <p>
          Doctors can only start video consultations from a computer registered
          here, so they don't need the consultation ID from you. To register the
          room computer (or TV), sign in as an admin on that computer, open this
          screen and press Register. Doctors then sign in there and press Start
          video call. If the computer's browser data is cleared, register it
          again and remove the old entry.
        </p>
      </header>

      {loadError ? (
        <p role="alert" className="cp-note cp-note-error">
          Couldn't load the registered computers. Refresh the page.
        </p>
      ) : devices === null ? (
        <p className="cp-loading" role="status">Loading…</p>
      ) : (
        <>
          {thisActive ? (
            <p className="cp-note cp-note-ok" role="status">
              This computer is registered as &ldquo;{thisRecord.label}&rdquo;.
            </p>
          ) : (
            <form onSubmit={register} className="cp-field" style={{ marginBottom: 16 }}>
              <label htmlFor="cp-room-label">Register this computer as</label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input
                  id="cp-room-label"
                  className="cp-text"
                  style={{ maxWidth: 320 }}
                  value={label}
                  maxLength={60}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || label.trim().length < 2}
                >
                  Register this computer
                </button>
              </div>
              <p className="cp-help">
                Only do this on the computer in the telemedicine room.
              </p>
            </form>
          )}

          {active.length === 0 ? (
            <p className="cp-help">
              No computer is registered yet, so doctors can't start video calls.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {active.map((d) => (
                <li
                  key={d.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    padding: "10px 0",
                    borderTop: "1px solid rgba(0,0,0,0.08)",
                  }}
                >
                  <div>
                    <strong>{d.label}</strong>
                    {d.id === thisDevice?.id && (
                      <span className="status-pill confirmed" style={{ marginLeft: 8 }}>
                        This computer
                      </span>
                    )}
                    <div className="admin-cell-sub">
                      Registered {d.createdAt ? formatDateTime(d.createdAt) : "just now"}
                      {d.lastUsedAt ? ` · last call ${formatDateTime(d.lastUsedAt)}` : " · not used yet"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={busy}
                    onClick={() => setRevoking(d)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {note && (
        <p role={note.tone === "error" ? "alert" : "status"} className={`cp-note cp-note-${note.tone}`}>
          {note.text}
        </p>
      )}

      {revoking && (
        <ConfirmDialog
          title={`Remove "${revoking.label}"?`}
          body="Doctors won't be able to start video calls from this computer until it is registered again. Calls already running are not cut off."
          confirmLabel="Remove"
          tone="danger"
          onConfirm={() => revoke(revoking)}
          onClose={() => setRevoking(null)}
        />
      )}
    </section>
  );
}
