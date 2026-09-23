import { useMemo, useState } from "react";
import SchedulingModal from "./schedulingModal.jsx";
import CreateScheduleModal from "./createScheduleModal.jsx";
import ConfirmDialog from "./confirmDialog.jsx";
import {
  IconPhone,
  IconCalendar,
  IconCheck,
  IconPlus,
  IconX,
} from "./icons.jsx";

// Inline to avoid assuming icons.jsx exports these — move into icons.jsx
// alongside the others if you'd rather keep icon imports centralized.
function IconSearch({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="8.5"
        cy="8.5"
        r="5.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M17 17l-3.8-3.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconCopy({ size = 13 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="7"
        y="7"
        width="9"
        height="9"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M4.5 13V5.5A1.5 1.5 0 0 1 6 4h7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Small "code chip with copy button" used for consultation IDs, booking IDs
// and slot IDs alike. `copiedId`/`onCopy` are lifted to the parent so only
// one "Copied" label shows at a time across the whole table.
function CopyableId({ id, copiedId, onCopy }) {
  const justCopied = copiedId === id;

  async function handleCopy(e) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      onCopy(id);
    } catch {
      // Clipboard API can fail (permissions, insecure context) — the ID is
      // still visible in the chip, so the admin can select/copy manually.
    }
  }

  return (
    <span
      className="code-chip"
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      {id}
      <button
        type="button"
        onClick={handleCopy}
        title="Copy ID"
        aria-label={`Copy ${id}`}
        className="btn-icon-inline"
        style={{
          display: "inline-flex",
          alignItems: "center",
          color: "inherit",
        }}
      >
        <IconCopy />
      </button>
      {justCopied && (
        <span className="admin-cell-sub" style={{ color: "#0095D9" }}>
          Copied
        </span>
      )}
    </span>
  );
}

function SearchInput({ value, onChange, placeholder }) {
  return (
    <div
      className="admin-search"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        border: "1px solid var(--admin-border, #DCE6EC)",
        borderRadius: 8,
        padding: "6px 10px",
        maxWidth: 320,
        marginBottom: 14,
      }}
    >
      <IconSearch />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ border: "none", outline: "none", flex: 1, fontSize: 13.5 }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          style={{ display: "flex", color: "inherit" }}
        >
          <IconX size={13} />
        </button>
      )}
    </div>
  );
}

export default function BookingsPanel({
  bookings,
  doctors,
  slots,
  onSchedule,
  onMarkDone,
  onCreateSlot,
  onCancelSlot,
}) {
  const [subtab, setSubtab] = useState("toSchedule");
  const [activeBooking, setActiveBooking] = useState(null);
  const [closing, setClosing] = useState(null);
  const [creatingSlot, setCreatingSlot] = useState(false);
  const [cancellingSlot, setCancellingSlot] = useState(null);

  // One query per subtab, so switching tabs doesn't lose what you typed
  // in another — an admin bouncing between "Scheduled" and "Reschedule
  // requests" to compare the same patient shouldn't have to retype it.
  const [queries, setQueries] = useState({
    toSchedule: "",
    scheduled: "",
    reschedules: "",
    slots: "",
  });
  const query = queries[subtab];
  const setQuery = (value) =>
    setQueries((prev) => ({ ...prev, [subtab]: value }));

  const [copiedId, setCopiedId] = useState(null);
  function handleCopy(id) {
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
  }

  // Every booking that reaches this dashboard has already been paid —
  // the server only writes a booking record after Flutterwave confirms
  // the charge, so there's no "pending payment" state to filter on here
  // any more. This just guards against a stray/failed record slipping
  // through rather than doing any real gating.
  const toSchedule = bookings.filter(
    (b) => b.paymentStatus !== "failed" && !b.consultationId,
  );
  const scheduled = bookings.filter((b) => b.consultationId);
  const reschedules = bookings.filter((b) => b.rescheduleRequested);
  const openSlots = slots.filter((s) => s.status === "open");

  const doctorName = (id) => doctors.find((d) => d.id === id)?.name ?? "—";

  const rows =
    subtab === "toSchedule"
      ? toSchedule
      : subtab === "scheduled"
        ? scheduled
        : subtab === "reschedules"
          ? reschedules
          : null;

  const filteredRows = useMemo(() => {
    if (!rows) return rows;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((b) => {
      const haystack = [
        b.patientName,
        b.phone,
        b.type,
        b.mode,
        b.bookingId,
        b.consultationId,
        doctorName(b.doctorId),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, doctors]);

  const filteredSlots = useMemo(() => {
    const q = queries.slots.trim().toLowerCase();
    if (!q) return slots;
    return slots.filter((s) => {
      const haystack = [
        s.id,
        doctorName(s.doctorId),
        s.type,
        s.mode,
        s.status,
        s.date,
        s.startTime,
        s.endTime,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, queries.slots, doctors]);

  const SEARCH_PLACEHOLDER = {
    toSchedule: "Search by patient, phone, or booking ID…",
    scheduled: "Search by patient, doctor, or consultation ID…",
    reschedules: "Search by patient or phone…",
    slots: "Search by doctor, date, or slot ID…",
  };

  return (
    <>
      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <h2>New bookings</h2>
            <p>
              Assign a doctor and time to each paid booking, or open a slot for
              patients to book directly
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setCreatingSlot(true)}
          >
            <IconPlus size={14} /> Create schedule
          </button>
        </div>

        <div className="admin-subtabs">
          <button
            className={`admin-subtab${subtab === "toSchedule" ? " active" : ""}`}
            onClick={() => setSubtab("toSchedule")}
          >
            To schedule ({toSchedule.length})
          </button>
          <button
            className={`admin-subtab${subtab === "scheduled" ? " active" : ""}`}
            onClick={() => setSubtab("scheduled")}
          >
            Scheduled ({scheduled.length})
          </button>
          <button
            className={`admin-subtab${subtab === "reschedules" ? " active" : ""}`}
            onClick={() => setSubtab("reschedules")}
          >
            Reschedule requests ({reschedules.length})
          </button>
          <button
            className={`admin-subtab${subtab === "slots" ? " active" : ""}`}
            onClick={() => setSubtab("slots")}
          >
            Available slots ({openSlots.length})
          </button>
        </div>

        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={SEARCH_PLACEHOLDER[subtab]}
        />

        {subtab === "slots" ? (
          slots.length === 0 ? (
            <div className="admin-empty">
              No slots created yet. Use Create schedule to open one.
            </div>
          ) : filteredSlots.length === 0 ? (
            <div className="admin-empty">No slots match "{queries.slots}".</div>
          ) : (
            <div className="admin-panel-body">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Slot ID</th>
                    <th>Doctor</th>
                    <th>Type / mode</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSlots.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <CopyableId
                          id={s.id}
                          copiedId={copiedId}
                          onCopy={handleCopy}
                        />
                      </td>
                      <td className="admin-cell-name">
                        {doctorName(s.doctorId)}
                      </td>
                      <td>
                        <div>{s.type}</div>
                        <div className="admin-cell-sub">{s.mode}</div>
                      </td>
                      <td>{new Date(s.date).toLocaleDateString()}</td>
                      <td>
                        {s.startTime}–{s.endTime}
                      </td>
                      <td>
                        <span className={`status-pill slot-${s.status}`}>
                          {s.status === "open" ? "Open" : "Booked"}
                        </span>
                      </td>
                      <td>
                        {s.status === "open" && (
                          <div className="admin-row-actions">
                            <button
                              className="btn btn-outline danger"
                              onClick={() => setCancellingSlot(s)}
                            >
                              <IconX size={14} /> Cancel
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : rows.length === 0 ? (
          <div className="admin-empty">
            {subtab === "toSchedule"
              ? "Every paid booking has a doctor and a time slot."
              : "Nothing here right now."}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="admin-empty">No results match "{query}".</div>
        ) : (
          <div className="admin-panel-body">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Type / mode</th>
                  {subtab === "toSchedule" && <th>Booking ID</th>}
                  {subtab !== "toSchedule" && <th>Schedule</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((b) => (
                  <tr key={b.bookingId}>
                    <td>
                      <div className="admin-cell-name">{b.patientName}</div>
                      <div className="admin-cell-sub">{b.phone}</div>
                    </td>
                    <td>
                      <div>{b.type}</div>
                      <div className="admin-cell-sub">{b.mode}</div>
                    </td>
                    {subtab === "toSchedule" && (
                      <td>
                        <CopyableId
                          id={b.bookingId}
                          copiedId={copiedId}
                          onCopy={handleCopy}
                        />
                      </td>
                    )}
                    {subtab !== "toSchedule" && (
                      <td>
                        {b.consultationId ? (
                          <>
                            <CopyableId
                              id={b.consultationId}
                              copiedId={copiedId}
                              onCopy={handleCopy}
                            />
                            <div
                              className="admin-cell-sub"
                              style={{ marginTop: 4 }}
                            >
                              {doctorName(b.doctorId)} ·{" "}
                              {b.scheduledTime
                                ? new Date(b.scheduledTime).toLocaleString()
                                : "—"}
                            </div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                    <td>
                      <div className="admin-row-actions">
                        {subtab === "toSchedule" && (
                          <button
                            className="btn btn-secondary"
                            onClick={() => setActiveBooking(b)}
                          >
                            <IconCalendar size={14} /> Schedule
                          </button>
                        )}
                        {subtab === "reschedules" && (
                          <button
                            className="btn btn-outline"
                            onClick={() => setActiveBooking(b)}
                          >
                            <IconPhone size={14} /> Reschedule
                          </button>
                        )}
                        {subtab === "scheduled" && b.mode === "In person" && (
                          <button
                            className="btn btn-primary"
                            onClick={() => setClosing(b)}
                          >
                            <IconCheck size={14} /> Mark done
                          </button>
                        )}
                        {subtab === "scheduled" && b.mode === "Online" && (
                          <span className="admin-cell-sub">
                            Closed by the doctor
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {activeBooking && (
        <SchedulingModal
          booking={activeBooking}
          doctors={doctors}
          onClose={() => setActiveBooking(null)}
          onConfirm={(payload) => {
            onSchedule(payload);
            setActiveBooking(null);
          }}
        />
      )}

      {creatingSlot && (
        <CreateScheduleModal
          doctors={doctors}
          existingSlots={slots}
          onClose={() => setCreatingSlot(false)}
          onCreate={(slot) => {
            onCreateSlot(slot);
            setCreatingSlot(false);
          }}
        />
      )}

      {cancellingSlot && (
        <ConfirmDialog
          title="Cancel this slot?"
          body={
            <>
              This removes the {cancellingSlot.startTime}–
              {cancellingSlot.endTime} opening for{" "}
              {doctorName(cancellingSlot.doctorId)} on{" "}
              {new Date(cancellingSlot.date).toLocaleDateString()}. Patients
              will no longer see it as bookable.
            </>
          }
          confirmLabel="Cancel slot"
          tone="danger"
          onConfirm={() => {
            onCancelSlot(cancellingSlot);
            setCancellingSlot(null);
          }}
          onClose={() => setCancellingSlot(null)}
        />
      )}

      {closing && (
        <ConfirmDialog
          title="Mark this consultation done?"
          body={
            <>
              This ends {closing.patientName}'s consultation, expires{" "}
              {closing.consultationId} permanently, and{" "}
              <strong>deletes their booking record</strong>. There are no
              backups, so it cannot be undone. Only continue if{" "}
              {doctorName(closing.doctorId)} has actually seen the patient.
            </>
          }
          confirmLabel="Mark done"
          tone="danger"
          onConfirm={() => {
            onMarkDone(closing);
            setClosing(null);
          }}
          onClose={() => setClosing(null)}
        />
      )}
    </>
  );
}
