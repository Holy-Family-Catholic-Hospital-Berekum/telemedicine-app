import { useMemo, useState } from "react";

// Admin creates an open slot — a doctor, a consultation type, and a time
// window when that doctor is free. Patients see this as a specific
// bookable slot, as an alternative to the general flow (pay first, admin
// assigns doctor and time afterwards).
//
// IMPORTANT: overlap checking here is a client-side convenience only. Two
// admins creating slots for the same doctor at the same time is a real
// race condition — the Cloud Function that writes availableSlots must
// re-check for an overlap inside a transaction before committing, the same
// way reference-code claims are protected (architecture 4.3).

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

const EMPTY = { doctorId: "", mode: "", date: "", startTime: "", endTime: "" };

export default function CreateScheduleModal({ doctors, existingSlots, onClose, onCreate }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setError(null);
  };

  const doctor = doctors.find((d) => d.id === form.doctorId);

  const conflict = useMemo(() => {
    if (!form.doctorId || !form.date || !form.startTime || !form.endTime) return null;
    return existingSlots.find(
      (s) =>
        s.doctorId === form.doctorId &&
        s.date === form.date &&
        s.status !== "cancelled" &&
        overlaps(form.startTime, form.endTime, s.startTime, s.endTime),
    );
  }, [form, existingSlots]);

  const timeValid =
    form.startTime && form.endTime && toMinutes(form.endTime) > toMinutes(form.startTime);

  const canSubmit = form.doctorId && form.mode && form.date && timeValid && !conflict;

  const submit = () => {
    if (!canSubmit) {
      if (form.startTime && form.endTime && !timeValid) {
        setError("End time must be after start time.");
      }
      return;
    }
    onCreate({
      doctorId: form.doctorId,
      type: doctor?.department,
      mode: form.mode,
      date: form.date,
      startTime: form.startTime,
      endTime: form.endTime,
    });
  };

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div
        className="admin-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Create schedule"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Create an available slot</h3>
        <p className="sub">
          Open a time window when a doctor is free. Patients will see this as
          a bookable slot instead of waiting for admin to assign a time after
          payment.
        </p>

        <div className="admin-field">
          <label htmlFor="cs-doctor">Doctor</label>
          <select id="cs-doctor" value={form.doctorId} onChange={set("doctorId")}>
            <option value="">Select a doctor…</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} — {d.department}
              </option>
            ))}
          </select>
        </div>

        {doctor && (
          <p className="field-hint">
            Slot will be listed under {doctor.department}. Patients booking it
            skip the general assignment step.
          </p>
        )}

        <div className="admin-field">
          <label htmlFor="cs-mode">Mode</label>
          <select id="cs-mode" value={form.mode} onChange={set("mode")}>
            <option value="">Select how the doctor is available…</option>
            <option value="Online">Online</option>
            <option value="In person">In person</option>
          </select>
        </div>

        <div className="admin-field">
          <label htmlFor="cs-date">Date</label>
          <input id="cs-date" type="date" value={form.date} onChange={set("date")} />
        </div>

        <div className="verify-grid">
          <div className="admin-field">
            <label htmlFor="cs-start">Available from</label>
            <input id="cs-start" type="time" value={form.startTime} onChange={set("startTime")} />
          </div>
          <div className="admin-field">
            <label htmlFor="cs-end">Available until</label>
            <input id="cs-end" type="time" value={form.endTime} onChange={set("endTime")} />
          </div>
        </div>

        {error && <p className="field-error">{error}</p>}

        {conflict && (
          <div className="match-result bad">
            <div>
              <strong>This overlaps an existing slot for {doctor?.name}.</strong>
              <p>
                {conflict.startTime}–{conflict.endTime} on {conflict.date} is
                already {conflict.status}. Pick a different window.
              </p>
            </div>
          </div>
        )}

        <div className="admin-modal-actions">
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>
            Create slot
          </button>
        </div>
      </div>
    </div>
  );
}
