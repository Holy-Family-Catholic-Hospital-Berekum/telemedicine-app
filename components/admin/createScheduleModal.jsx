import { useMemo, useState } from "react";

import { TYPE_LABELS } from "../../src/constants";
import DateSelect from "../shared/dateSelect";

// Admin creates an open slot — a doctor, a consultation type, and a time
// window when that doctor is free. Patients see this as a specific
// bookable slot, as an alternative to the general flow (pay first, admin
// assigns doctor and time afterwards). Times are hospital time (UTC+0).
//
// The overlap check here is a convenience; createAvailableSlot re-checks
// inside a transaction on the server.

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

const EMPTY = { doctorUid: "", type: "", mode: "", date: "", startTime: "", endTime: "" };

export default function CreateScheduleModal({ doctors, existingSlots, onClose, onCreate }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setError(null);
  };

  const doctor = doctors.find((d) => d.id === form.doctorUid);
  const typesForDoctor = doctor?.availableFor?.length
    ? doctor.availableFor
    : Object.keys(TYPE_LABELS);

  const conflict = useMemo(() => {
    if (!form.doctorUid || !form.date || !form.startTime || !form.endTime) return null;
    return existingSlots.find(
      (s) =>
        s.doctorUid === form.doctorUid &&
        s.date === form.date &&
        s.status !== "cancelled" &&
        overlaps(form.startTime, form.endTime, s.startTime, s.endTime),
    );
  }, [form, existingSlots]);

  const timeValid =
    form.startTime && form.endTime && toMinutes(form.endTime) > toMinutes(form.startTime);

  const canSubmit =
    form.doctorUid && form.type && form.mode && form.date && timeValid && !conflict;

  const submit = () => {
    if (!canSubmit) {
      if (form.startTime && form.endTime && !timeValid) {
        setError("End time must be after start time.");
      }
      return;
    }
    onCreate({
      doctorUid: form.doctorUid,
      type: form.type,
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
          <select id="cs-doctor" value={form.doctorUid} onChange={set("doctorUid")}>
            <option value="">Select a doctor…</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} — {d.department}
              </option>
            ))}
          </select>
        </div>

        <div className="admin-field">
          <label htmlFor="cs-type">Consultation type</label>
          <select id="cs-type" value={form.type} onChange={set("type")}>
            <option value="">Select a type…</option>
            {typesForDoctor.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </select>
        </div>

        <div className="admin-field">
          <label htmlFor="cs-mode">Mode</label>
          <select id="cs-mode" value={form.mode} onChange={set("mode")}>
            <option value="">Select how the doctor is available…</option>
            <option value="online">Video call</option>
            <option value="in_person">At the hospital</option>
          </select>
        </div>

        <div className="admin-field">
          <label htmlFor="cs-date">Date</label>
          <DateSelect
            id="cs-date"
            value={form.date}
            onChange={(date) => {
              setForm((f) => ({ ...f, date }));
              setError(null);
            }}
            fromYear={new Date().getUTCFullYear()}
            toYear={new Date().getUTCFullYear() + 1}
            selectClassName="admin-date-part"
          />
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
