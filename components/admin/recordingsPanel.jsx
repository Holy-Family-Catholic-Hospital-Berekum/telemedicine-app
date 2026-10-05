import { useMemo, useState } from "react";
import { collection, limit, orderBy, query, where } from "firebase/firestore";

import { db } from "../../src/firebase";
import { useAuth } from "../../src/context/authContext.jsx";
import { TYPE_LABELS, formatDateTime } from "../../src/constants";
import { useFirestoreCollection } from "./hooks/useFirestoreCollection.js";
import { IconSearch, IconTrash, IconAlert } from "./icons.jsx";

// Call recordings, admin only (rules deny everyone else). Nothing here can
// read the files directly: play and download ask getRecordingUrl for a
// 10-minute signed link, which requires a reason and is written to the
// audit log. Deleting needs two admins: one requests it (with a reason),
// a different admin approves it, and only then are the files deleted
// (recordings.js requestRecordingDeletion / decideDeletionRequest).
// Requests expire after 72 hours. Every step is audited.

const LIST_LIMIT = 300;

const STATUS_LABEL = {
  recording: "Recording",
  finalizing: "Saving",
  available: "Available",
  partial: "Partial",
  failed: "Failed",
};

function duration(sec) {
  if (!Number.isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${String(s).padStart(2, "0")}s`;
}

function size(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

/** A small dialog that collects a reason before an audited action. */
function ReasonDialog({ title, body, confirmLabel, tone, requireTyped, busy, error, onConfirm, onClose }) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const ok = reason.trim().length >= 3 && (!requireTyped || typed === requireTyped);
  return (
    <div className="admin-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="admin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {body && <p className="sub">{body}</p>}
        <div className="admin-field">
          <label htmlFor="rec-reason">Reason (kept in the audit log)</label>
          <textarea
            id="rec-reason"
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Patient complaint ref. 2026-114"
          />
        </div>
        {requireTyped && (
          <div className="admin-field">
            <label htmlFor="rec-typed">Type {requireTyped} to confirm</label>
            <input id="rec-typed" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
        )}
        {error && <p className="field-error">{error}</p>}
        <div className="admin-modal-actions">
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className={`btn ${tone === "danger" ? "btn-outline danger" : "btn-primary"}`}
            disabled={!ok || busy}
            onClick={() => onConfirm(reason.trim())}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Deletion requests waiting for a second admin. */
function PendingDeletions({ callAdmin, onMessage }) {
  const { user } = useAuth();
  const pendingQuery = useMemo(
    () => query(collection(db, "deletionRequests"), where("status", "==", "pending")),
    [],
  );
  const { data: pending } = useFirestoreCollection(pendingQuery);
  const [deciding, setDeciding] = useState(null); // { request, decision }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // When the tab was opened; good enough to hide expired requests.
  const [openedAt] = useState(() => Date.now());

  const live = pending
    .filter((r) => !r.expiresAt || new Date(r.expiresAt).getTime() > openedAt)
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  if (live.length === 0) return null;

  async function decide(note) {
    setBusy(true);
    setError(null);
    try {
      const data = await callAdmin("decideDeletionRequest", {
        requestId: deciding.request.id,
        decision: deciding.decision,
        note,
      });
      onMessage(
        data.status === "done"
          ? `Approved. ${data.deleted} recording${data.deleted === 1 ? "" : "s"} deleted.`
          : "Deletion request rejected.",
      );
      setDeciding(null);
    } catch {
      setError("That didn't go through. See the message above.");
    } finally {
      setBusy(false);
    }
  }

  const describe = (r) =>
    r.kind === "before"
      ? `${r.target?.count ?? "?"} recording(s) made before ${formatDateTime(r.target?.before)}`
      : `Recording of consultation ${r.target?.consultationId || r.target?.recordingId} (${formatDateTime(r.target?.startedAt)})`;

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <div>
          <h2>Deletions waiting for approval ({live.length})</h2>
          <p>A recording is deleted only when a second admin approves. Requests expire after 72 hours.</p>
        </div>
      </div>
      <div className="admin-panel-body">
        <table className="admin-table">
          <thead>
            <tr>
              <th>What</th>
              <th>Requested by</th>
              <th>Reason</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {live.map((r) => {
              const mine = r.requestedByUid === user?.uid;
              return (
                <tr key={r.id}>
                  <td>{describe(r)}</td>
                  <td>
                    {r.requestedByName || "Admin"}
                    <div className="admin-cell-sub">{formatDateTime(r.createdAt)}</div>
                  </td>
                  <td className="admin-cell-sub">{r.reason}</td>
                  <td>
                    {mine ? (
                      <span className="admin-cell-sub">Waiting for another admin</span>
                    ) : (
                      <div className="admin-row-actions">
                        <button
                          className="btn btn-outline danger"
                          onClick={() => setDeciding({ request: r, decision: "approve" })}
                        >
                          Approve deletion
                        </button>
                        <button
                          className="btn btn-outline"
                          onClick={() => setDeciding({ request: r, decision: "reject" })}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {deciding && (
        <ReasonDialog
          title={deciding.decision === "approve" ? "Approve and delete permanently?" : "Reject this request?"}
          body={
            deciding.decision === "approve"
              ? `${describe(deciding.request)}. Requested by ${deciding.request.requestedByName || "another admin"}: "${deciding.request.reason}". This cannot be undone.`
              : describe(deciding.request)
          }
          confirmLabel={deciding.decision === "approve" ? "Approve and delete" : "Reject"}
          tone={deciding.decision === "approve" ? "danger" : undefined}
          requireTyped={deciding.decision === "approve" ? "DELETE" : undefined}
          busy={busy}
          error={error}
          onConfirm={decide}
          onClose={() => !busy && setDeciding(null)}
        />
      )}
    </section>
  );
}

export default function RecordingsPanel({ callAdmin }) {
  const recordingsQuery = useMemo(
    () => query(collection(db, "recordings"), orderBy("startedAt", "desc"), limit(LIST_LIMIT)),
    [],
  );
  const { data: recordings, loading, error } = useFirestoreCollection(recordingsQuery);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // { kind: "play" | "download" | "delete" | "bulk", recording? , count? }
  const [action, setAction] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [player, setPlayer] = useState(null); // { url, recording }
  const [bulkBefore, setBulkBefore] = useState("");
  const [message, setMessage] = useState(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromMs = from ? Date.parse(`${from}T00:00:00Z`) : null;
    const toMs = to ? Date.parse(`${to}T23:59:59Z`) : null;
    return recordings.filter((r) => {
      const t = r.startedAt ? new Date(r.startedAt).getTime() : null;
      if (fromMs && (!t || t < fromMs)) return false;
      if (toMs && (!t || t > toMs)) return false;
      if (!q) return true;
      return [r.patientName, r.doctorName, r.consultationId, r.id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [recordings, search, from, to]);

  function close() {
    setAction(null);
    setActionError(null);
    setBusy(false);
  }

  async function run(fn) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      close();
    } catch {
      // callAdmin already shows the error banner; keep the dialog open.
      setActionError("That didn't go through. See the message above.");
      setBusy(false);
    }
  }

  function handleConfirm(reason) {
    const r = action.recording;
    if (action.kind === "play" || action.kind === "download") {
      return run(async () => {
        const data = await callAdmin("getRecordingUrl", {
          recordingId: r.id,
          purpose: action.kind,
          reason,
        });
        if (action.kind === "play") {
          setPlayer({ url: data.url, recording: r });
        } else {
          const a = document.createElement("a");
          a.href = data.url;
          a.download = data.filename;
          a.rel = "noopener";
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      });
    }
    if (action.kind === "delete") {
      return run(async () => {
        await callAdmin("requestRecordingDeletion", { kind: "single", recordingId: r.id, reason });
        setMessage("Deletion requested. Another admin must approve it before the recording is deleted.");
      });
    }
    if (action.kind === "bulk") {
      return run(async () => {
        await callAdmin("requestRecordingDeletion", {
          kind: "before",
          before: `${bulkBefore}T00:00:00Z`,
          reason,
        });
        setMessage("Deletion requested. Another admin must approve it before anything is deleted.");
      });
    }
    return undefined;
  }

  async function startBulk() {
    setMessage(null);
    try {
      const data = await callAdmin("requestRecordingDeletion", {
        kind: "before",
        before: `${bulkBefore}T00:00:00Z`,
        dryRun: true,
      });
      if (data.count === 0) {
        setMessage(`No finished recordings before ${bulkBefore}.`);
        return;
      }
      setAction({ kind: "bulk", count: data.count, capped: data.capped });
    } catch {
      // banner shown by callAdmin
    }
  }

  return (
    <>
      <div className="admin-banner">
        <IconAlert size={18} />
        <p>
          Recordings contain identifiable patient video and audio. Open them
          only for a legitimate reason. Every play, download and deletion is
          recorded in the audit log with your name and reason.
        </p>
      </div>

      {message && (
        <div className="admin-alert" role="status" onClick={() => setMessage(null)}>
          {message}
        </div>
      )}

      <PendingDeletions callAdmin={callAdmin} onMessage={setMessage} />

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <h2>Call recordings</h2>
            <p>
              {rows.length} shown
              {recordings.length === LIST_LIMIT ? ` (latest ${LIST_LIMIT})` : ""}
            </p>
          </div>
          <div className="admin-search">
            <IconSearch size={15} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Patient, doctor or consultation ID"
            />
          </div>
        </div>

        <div className="admin-subtabs" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label className="admin-cell-sub" htmlFor="rec-from">From</label>
          <input id="rec-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <label className="admin-cell-sub" htmlFor="rec-to">To</label>
          <input id="rec-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

        {error ? (
          <div className="admin-empty">Couldn't load recordings.</div>
        ) : loading ? (
          <div className="admin-empty">Loading recordings…</div>
        ) : rows.length === 0 ? (
          <div className="admin-empty">No recordings match these filters.</div>
        ) : (
          <div className="admin-panel-body">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Recorded</th>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Consultation</th>
                  <th>Length</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ready = r.status === "available" || r.status === "partial";
                  const busyStatus = r.status === "recording" || r.status === "finalizing";
                  return (
                    <tr key={r.id}>
                      <td className="admin-cell-sub">{formatDateTime(r.startedAt)}</td>
                      <td className="admin-cell-name">{r.patientName || "—"}</td>
                      <td>{r.doctorName || "—"}</td>
                      <td>
                        <span className="code-chip">{r.consultationId}</span>
                        <div className="admin-cell-sub">
                          {TYPE_LABELS[r.consultationType] ?? r.consultationType}
                        </div>
                      </td>
                      <td>
                        {duration(r.durationSec)}
                        <div className="admin-cell-sub">
                          {r.mode === "audio" ? "Audio" : "Video"} · {size(r.sizeBytes)}
                        </div>
                      </td>
                      <td>
                        <span className={`status-pill ${ready ? "confirmed" : busyStatus ? "" : "rejected"}`}>
                          {STATUS_LABEL[r.status] ?? r.status}
                        </span>
                        {r.integrity?.sha256 && (
                          <div className="admin-cell-sub" title={`SHA-256 ${r.integrity.sha256}`}>
                            SHA-256 {r.integrity.sha256.slice(0, 10)}…
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="admin-row-actions">
                          {ready && (
                            <>
                              <button className="btn btn-secondary" onClick={() => setAction({ kind: "play", recording: r })}>
                                Play
                              </button>
                              <button className="btn btn-outline" onClick={() => setAction({ kind: "download", recording: r })}>
                                Download
                              </button>
                            </>
                          )}
                          {!busyStatus && (
                            <button
                              className="btn btn-outline danger"
                              onClick={() => setAction({ kind: "delete", recording: r })}
                              aria-label="Delete recording"
                            >
                              <IconTrash size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <h2>Delete older recordings</h2>
            <p>
              Asks to delete every finished recording made before the chosen
              date. Nothing is deleted until another admin approves.
            </p>
          </div>
        </div>
        <div className="admin-panel-body" style={{ display: "flex", gap: 12, alignItems: "center", padding: "16px 22px" }}>
          <label htmlFor="rec-bulk" className="admin-cell-sub">Recorded before</label>
          <input
            id="rec-bulk"
            type="date"
            value={bulkBefore}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setBulkBefore(e.target.value)}
          />
          <button className="btn btn-outline danger" disabled={!bulkBefore} onClick={startBulk}>
            <IconTrash size={14} /> Find and request deletion…
          </button>
        </div>
      </section>

      {action && (
        <ReasonDialog
          title={
            action.kind === "play"
              ? "Play this recording?"
              : action.kind === "download"
                ? "Download this recording?"
                : action.kind === "delete"
                  ? "Request deletion of this recording?"
                  : `Request deletion of ${action.count} recording${action.count === 1 ? "" : "s"}?`
          }
          body={
            action.kind === "bulk"
              ? `Every finished recording made before ${bulkBefore}${
                  action.capped ? " (up to 500 at a time)" : ""
                }. Another admin must approve; once they do, it cannot be undone.`
              : action.kind === "delete"
                ? `${action.recording.patientName || "Patient"} with ${action.recording.doctorName || "doctor"}, ${formatDateTime(action.recording.startedAt)}. Another admin must approve; once they do, it cannot be undone.`
                : `${action.recording.patientName || "Patient"} with ${action.recording.doctorName || "doctor"}, ${formatDateTime(action.recording.startedAt)}.${
                    action.kind === "download"
                      ? " A downloaded copy leaves the platform's protections: store it securely."
                      : ""
                  }`
          }
          confirmLabel={
            action.kind === "play" ? "Play" : action.kind === "download" ? "Download" : "Request deletion"
          }
          tone={action.kind === "delete" || action.kind === "bulk" ? "danger" : undefined}
          requireTyped={undefined}
          busy={busy}
          error={actionError}
          onConfirm={handleConfirm}
          onClose={close}
        />
      )}

      {player && (
        <div className="admin-modal-backdrop" onClick={() => setPlayer(null)}>
          <div className="admin-modal" style={{ maxWidth: 900, width: "95vw" }} onClick={(e) => e.stopPropagation()}>
            <h3>
              {player.recording.patientName} · {player.recording.doctorName}
            </h3>
            <p className="sub">
              {formatDateTime(player.recording.startedAt)} · link expires in 10 minutes
            </p>
            {/* No download button on the player: downloads go through the
                separate, separately audited Download action. */}
            {player.recording.mode === "audio" ? (
              <audio
                src={player.url}
                controls
                controlsList="nodownload"
                autoPlay
                style={{ width: "100%" }}
                onContextMenu={(e) => e.preventDefault()}
              />
            ) : (
              <video
                src={player.url}
                controls
                controlsList="nodownload"
                autoPlay
                style={{ width: "100%", background: "#000", borderRadius: 8 }}
                onContextMenu={(e) => e.preventDefault()}
              />
            )}
            <div className="admin-modal-actions">
              <button className="btn btn-outline" onClick={() => setPlayer(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
