import { useMemo, useState } from "react";
import SchedulingModal from "./schedulingModal.jsx";
import CreateScheduleModal from "./createScheduleModal.jsx";
import ConfirmDialog from "./confirmDialog.jsx";
import { TYPE_LABELS, MODE_LABELS, OUTCOME_LABELS, formatDateTime } from "../../src/constants";
import {
  IconPhone,
  IconCalendar,
  IconCheck,
  IconPlus,
  IconX,
} from "./icons.jsx";
import { Pagination, LoadOlder } from "../shared/pagination.jsx";
import { usePagination } from "../shared/usePagination.js";

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

// Appointment email status, written by functions/email.js.
const EMAIL_STATUS = {
  pending: "Email to patient: sending…",
  sent: "Email sent to patient",
  failed: "Email failed — phone the patient",
  not_configured: "Email not set up — phone the patient",
};

export default function BookingsPanel({
  bookings,
  doctors,
  slots,
  window: win,
  onSchedule,
  onReschedule,
  onMarkDone,
  onCreateSlot,
  onCancelSlot,
}) {
  const [subtab, setSubtab] = useState("toSchedule");
  const [activeBooking, setActiveBooking] = useState(null);
  const [rescheduling, setRescheduling] = useState(null);
  const [closing, setClosing] = useState(null); // { booking, outcome }
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

  // admin.jsx only loads paid and scheduled bookings; unpaid drafts never
  // appear here.
  const toSchedule = bookings.filter((b) => b.status === "paid" && !b.consultationId);
  const scheduled = bookings.filter((b) => b.status === "scheduled");
  const reschedules = bookings.filter((b) => b.rescheduleRequest?.status === "requested");
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
        b.doctorName,
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
        s.doctorName,
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
  // On the "slots" subtab there are no booking rows (filteredRows is null).
  const pager = usePagination(filteredRows ?? [], 25, `${subtab}|${queries[subtab] ?? ""}`);
  const slotPager = usePagination(filteredSlots, 25, queries.slots);

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
                  {slotPager.pageItems.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <CopyableId
                          id={s.id}
                          copiedId={copiedId}
                          onCopy={handleCopy}
                        />
                      </td>
                      <td className="admin-cell-name">
                        {s.doctorName || doctorName(s.doctorUid)}
                      </td>
                      <td>
                        <div>{TYPE_LABELS[s.type] ?? s.type}</div>
                        <div className="admin-cell-sub">{MODE_LABELS[s.mode] ?? s.mode}</div>
                      </td>
                      <td>{s.date}</td>
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
              <Pagination {...slotPager} noun="slots" />
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
                {pager.pageItems.map((b) => (
                  <tr key={b.bookingId}>
                    <td>
                      <div className="admin-cell-name">{b.patientName}</div>
                      {b.forChild && (
                        <div className="admin-cell-sub">
                          Child · parent/guardian: {b.guardianName || "—"}
                        </div>
                      )}
                      <div className="admin-cell-sub">{b.phone}</div>
                    </td>
                    <td>
                      <div>{TYPE_LABELS[b.type] ?? b.type}</div>
                      <div className="admin-cell-sub">{MODE_LABELS[b.mode] ?? b.mode}</div>
                      {subtab === "toSchedule" && (b.requestedDoctorName || b.preferredTime) && (
                        <div className="admin-cell-sub">
                          Asked for {b.requestedDoctorName || "any doctor"}
                          {b.preferredTime ? ` · ${formatDateTime(b.preferredTime)}` : ""}
                          {b.slotLost ? " (slot taken)" : ""}
                        </div>
                      )}
                      {subtab === "reschedules" && (
                        <div className="admin-cell-sub">
                          Wants: {b.rescheduleRequest?.preferredTime || "any time"}
                          {b.rescheduleRequest?.reason ? ` · ${b.rescheduleRequest.reason}` : ""}
                        </div>
                      )}
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
                              {b.doctorName || "—"} ·{" "}
                              {formatDateTime(b.scheduledTime)}
                              {b.patientJoinedAt && b.doctorJoinedAt
                                ? " · call started"
                                : b.callStartedAt
                                  ? b.patientJoinedAt
                                    ? " · doctor hasn't joined"
                                    : " · patient hasn't joined"
                                  : ""}
                            </div>
                            {b.lastEmail && (
                              <div
                                className="admin-cell-sub"
                                style={{
                                  marginTop: 2,
                                  color:
                                    b.lastEmail.status === "sent"
                                      ? "var(--color-success)"
                                      : b.lastEmail.status === "pending"
                                        ? undefined
                                        : "var(--color-danger)",
                                }}
                              >
                                {EMAIL_STATUS[b.lastEmail.status] ?? b.lastEmail.status}
                              </div>
                            )}
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
                        {/* A call one side never joined was missed and can be moved. */}
                        {(subtab === "reschedules" ||
                          (subtab === "scheduled" && !(b.patientJoinedAt && b.doctorJoinedAt))) && (
                          <button
                            className="btn btn-outline"
                            onClick={() => setRescheduling(b)}
                          >
                            <IconPhone size={14} /> Reschedule
                          </button>
                        )}
                        {subtab === "scheduled" && (
                          <>
                            <button
                              className="btn btn-primary"
                              onClick={() => setClosing({ booking: b, outcome: "completed" })}
                            >
                              <IconCheck size={14} /> Completed
                            </button>
                            <button
                              className="btn btn-outline"
                              onClick={() => setClosing({ booking: b, outcome: "no_show" })}
                            >
                              No-show
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination {...pager} noun="bookings" />
          </div>
        )}
        {win && subtab !== "slots" && (
          <LoadOlder {...win} onLoadMore={win.loadMore} noun="bookings" />
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

      {rescheduling && (
        <SchedulingModal
          booking={rescheduling}
          doctors={doctors}
          reschedule
          onClose={() => setRescheduling(null)}
          onConfirm={({ doctorUid, scheduledTime }) => {
            onReschedule({ bookingId: rescheduling.bookingId, doctorUid, scheduledTime });
            setRescheduling(null);
          }}
          onDecline={
            rescheduling.rescheduleRequest?.status === "requested"
              ? () => {
                  onReschedule({ bookingId: rescheduling.bookingId, decline: true });
                  setRescheduling(null);
                }
              : undefined
          }
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
              {cancellingSlot.doctorName} on {cancellingSlot.date}. Patients
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
          title={`Close as ${OUTCOME_LABELS[closing.outcome].toLowerCase()}?`}
          body={
            <>
              This closes {closing.booking.patientName}'s consultation{" "}
              {closing.booking.consultationId} and{" "}
              <strong>permanently deletes their booking details</strong>{" "}
              (date of birth, sex, location, phone). A short history record
              (doctor, times, amount) is kept. It can't be undone.
              {closing.outcome === "completed" &&
                ` Only continue if ${closing.booking.doctorName || "the doctor"} has seen the patient.`}
            </>
          }
          confirmLabel={`Close as ${OUTCOME_LABELS[closing.outcome].toLowerCase()}`}
          tone="danger"
          onConfirm={() => {
            onMarkDone(closing.booking, closing.outcome);
            setClosing(null);
          }}
          onClose={() => setClosing(null)}
        />
      )}
    </>
  );
}
