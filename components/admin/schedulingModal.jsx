import { useState } from "react";
import { TYPE_LABELS, MODE_LABELS, toDate } from "../../src/constants";

// Admin assigns a doctor and time to a paid booking (or moves a scheduled
// one). scheduleConsultation / rescheduleConsultation on the server check
// the doctor, the time and clashes, and generate the consultation ID; the
// browser never makes one up.
//
// Times are entered as hospital time. Ghana is UTC+0 all year, so the
// datetime-local value is read as UTC regardless of the admin's own
// computer clock zone.

function toInputValue(value) {
  const d = toDate(value);
  return d ? d.toISOString().slice(0, 16) : "";
}

export default function SchedulingModal({
  booking,
  doctors,
  reschedule = false,
  onClose,
  onConfirm,
  onDecline,
}) {
  const [doctorUid, setDoctorUid] = useState(
    () =>
      (reschedule ? booking.doctorUid : booking.requestedDoctorUid) || "",
  );
  const [dateTime, setDateTime] = useState(() =>
    toInputValue(reschedule ? booking.scheduledTime : booking.preferredTime),
  );

  const eligible = doctors.filter(
    (d) =>
      (d.available || d.id === doctorUid) &&
      (d.availableFor.length === 0 || d.availableFor.includes(booking.type)),
  );
  const canSubmit = doctorUid && dateTime;

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{reschedule ? "Reschedule consultation" : "Schedule consultation"}</h3>
        <p className="sub">
          {booking.patientName} · {TYPE_LABELS[booking.type] ?? booking.type} ·{" "}
          {MODE_LABELS[booking.mode] ?? booking.mode}
        </p>

        {reschedule && booking.rescheduleRequest?.status === "requested" && (
          <p className="sub">
            Patient asked for: {booking.rescheduleRequest.preferredTime || "any time"}
            {booking.rescheduleRequest.reason
              ? ` — "${booking.rescheduleRequest.reason}"`
              : ""}
          </p>
        )}

        <div className="admin-field">
          <label htmlFor="sched-doctor">Assign doctor</label>
          <select
            id="sched-doctor"
            value={doctorUid}
            onChange={(e) => setDoctorUid(e.target.value)}
          >
            <option value="">Select an available doctor…</option>
            {eligible.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.department ? ` — ${d.department}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="admin-field">
          <label htmlFor="sched-time">Date & time (hospital time)</label>
          <input
            id="sched-time"
            type="datetime-local"
            value={dateTime}
            onChange={(e) => setDateTime(e.target.value)}
          />
        </div>

        <p className="sub" style={{ margin: 0 }}>
          {reschedule
            ? "Let the patient know the new time by call or WhatsApp — the app doesn't send it."
            : "A consultation ID is generated when you confirm. Contact the patient by call or WhatsApp with the time and ID — the app never sends them automatically."}
        </p>

        <div className="admin-modal-actions">
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          {onDecline && (
            <button className="btn btn-outline danger" onClick={onDecline}>
              Decline request
            </button>
          )}
          <button
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={() =>
              onConfirm({
                bookingId: booking.bookingId,
                doctorUid,
                scheduledTime: `${dateTime}:00Z`,
              })
            }
          >
            {reschedule ? "Save new time" : "Confirm & generate ID"}
          </button>
        </div>
      </div>
    </div>
  );
}
