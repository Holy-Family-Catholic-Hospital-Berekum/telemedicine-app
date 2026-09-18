import { useState } from "react";
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

        {subtab === "slots" ? (
          slots.length === 0 ? (
            <div className="admin-empty">
              No slots created yet. Use Create schedule to open one.
            </div>
          ) : (
            <div className="admin-panel-body">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Doctor</th>
                    <th>Type / mode</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((s) => (
                    <tr key={s.id}>
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
        ) : (
          <div className="admin-panel-body">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Type / mode</th>
                  {subtab !== "toSchedule" && <th>Schedule</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.bookingId}>
                    <td>
                      <div className="admin-cell-name">{b.patientName}</div>
                      <div className="admin-cell-sub">{b.phone}</div>
                    </td>
                    <td>
                      <div>{b.type}</div>
                      <div className="admin-cell-sub">{b.mode}</div>
                    </td>
                    {subtab !== "toSchedule" && (
                      <td>
                        {b.consultationId ? (
                          <>
                            <span className="code-chip">
                              {b.consultationId}
                            </span>
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
