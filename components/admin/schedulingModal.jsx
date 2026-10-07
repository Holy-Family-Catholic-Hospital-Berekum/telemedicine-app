import { useState } from "react";
import { TYPE_LABELS, MODE_LABELS, toDate } from "../../src/constants";
import DateSelect from "../shared/dateSelect";

// Admin assigns a doctor and time to a paid booking (or moves a scheduled
// one). scheduleConsultation / rescheduleConsultation on the server check
// the doctor, the time and clashes, and generate the consultation ID; the
// browser never makes one up.
//
// Times are entered as hospital time: a Day / Month / Year date and a time
// box. Ghana is UTC+0 all year, so they are sent as UTC regardless of the
// admin's own computer clock zone.

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
  const initial = toInputValue(reschedule ? booking.scheduledTime : booking.preferredTime);
  const [date, setDate] = useState(initial.slice(0, 10));
  const [time, setTime] = useState(initial.slice(11, 16));
  const dateTime = date && time ? `${date}T${time}` : "";

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
          <label htmlFor="sched-date">Date</label>
          <DateSelect
            id="sched-date"
            value={date}
            onChange={setDate}
            fromYear={new Date().getUTCFullYear()}
            toYear={new Date().getUTCFullYear() + 1}
            selectClassName="admin-date-part"
          />
        </div>
        <div className="admin-field">
          <label htmlFor="sched-time">Time (hospital time)</label>
          <input
            id="sched-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>

        <p className="sub" style={{ margin: 0 }}>
          {reschedule
            ? "The patient is emailed the new time automatically. Check the Scheduled list to see that the email went out."
            : "A consultation ID is generated when you confirm, and the patient is emailed the time and ID automatically. Check the Scheduled list to see that the email went out."}
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
