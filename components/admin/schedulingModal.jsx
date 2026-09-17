import { useState } from "react";

// Mirrors 4.4 Admin Service: admin assigns doctor + time slot, a Cloud
// Function then generates a unique consultation ID and stores it against
// the booking. Here the ID generation is mocked client-side for the demo —
// wire the onConfirm handler to your callable Cloud Function.
function generateConsultationId() {
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `CID-${Math.floor(10000 + Math.random() * 89999)}-${rand}`;
}

export default function SchedulingModal({ booking, doctors, onClose, onConfirm }) {
  const [doctorId, setDoctorId] = useState("");
  const [dateTime, setDateTime] = useState("");

  const canSubmit = doctorId && dateTime;

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Schedule consultation</h3>
        <p className="sub">
          {booking.patientName} · {booking.type} · {booking.mode}
        </p>

        <div className="admin-field">
          <label>Assign doctor</label>
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            <option value="">Select an available doctor…</option>
            {doctors.filter((d) => d.available).map((d) => (
              <option key={d.id} value={d.id}>{d.name} — {d.department}</option>
            ))}
          </select>
        </div>

        <div className="admin-field">
          <label>Date & time</label>
          <input type="datetime-local" value={dateTime} onChange={(e) => setDateTime(e.target.value)} />
        </div>

        <p className="sub" style={{ margin: 0 }}>
          A consultation ID will be generated and stored against this booking.
          Contact the patient by call or WhatsApp with the schedule and ID —
          the app itself never sends this automatically.
        </p>

        <div className="admin-modal-actions">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={() =>
              onConfirm({
                bookingId: booking.bookingId,
                doctorId,
                scheduledTime: new Date(dateTime).toISOString(),
                consultationId: generateConsultationId(),
              })
            }
          >
            Confirm & generate ID
          </button>
        </div>
      </div>
    </div>
  );
}