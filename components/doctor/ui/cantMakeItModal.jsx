import { useState } from 'react';
import { X, Loader2, CalendarX2 } from 'lucide-react';
import { formatDateTime } from '../../../src/constants';

// The doctor can't make an appointment (kind "doctor_absent"), or a video
// call that connected couldn't be completed (kind "call_incomplete"). The
// patient and admins are emailed straight away and the hospital gives the
// patient a new time (or a full refund). The optional note goes to the
// admin team only.
const TEXT = {
  doctor_absent: {
    title: "I can't make this appointment",
    body: "The patient is emailed now that you can't make it. The appointment leaves your list, and the hospital gives the patient a new time (with you or another doctor) or a full refund. This can't be undone.",
    placeholder: "e.g. On call in theatre; free from 2 pm",
  },
  call_incomplete: {
    title: "The call couldn't be completed",
    body: "Use this if the consultation couldn't be finished (for example the connection kept failing). The patient is emailed, the appointment leaves your list, and the hospital gives the patient a new time at no cost, or a full refund. This can't be undone.",
    placeholder: "e.g. Patient's connection kept dropping; about 5 minutes done",
  },
};

export default function CantMakeItModal({ consultation, kind = "doctor_absent", onClose, onSubmit }) {
  const text = kind === "call_incomplete" ? TEXT.call_incomplete : TEXT.doctor_absent;
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);
    await onSubmit({ consultation, reason: reason.trim(), kind });
    setSubmitting(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1A1C]/50 p-4">
      <div className="w-full max-w-md rounded-md bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#DCE6EC] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#12242C]">{text.title}</h2>
            <p className="text-xs text-[#5C6B72]">
              {consultation.patient.name} · {formatDateTime(consultation.scheduledTime)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-[#5C6B72] hover:text-[#12242C]">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-5">
          <div className="flex gap-3 rounded-md border border-[#DCE6EC] bg-[#F5F8FA] p-3.5">
            <CalendarX2 size={20} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: '#F88535' }} />
            <p className="text-sm text-[#12242C]">{text.body}</p>
          </div>

          <label className="mt-4 block text-sm font-medium text-[#12242C]" htmlFor="cant-make-it-note">
            Note for the admin team <span className="font-normal text-[#5C6B72]">(optional)</span>
          </label>
          <textarea
            id="cant-make-it-note"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 300))}
            rows={3}
            placeholder={text.placeholder}
            className="mt-1.5 w-full rounded-sm border border-[#DCE6EC] px-3 py-2 text-sm text-[#12242C] outline-none focus:border-[#0095D9]"
          />
          <p className="mt-1 text-xs text-[#5C6B72]">The patient doesn&apos;t see this note.</p>

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 rounded-sm border border-[#DCE6EC] py-2.5 text-sm font-medium text-[#12242C] transition hover:border-[#0095D9] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="flex flex-1 items-center justify-center gap-2 rounded-sm bg-[#B23A3A] py-2.5 text-sm font-medium text-white transition hover:bg-[#96302F] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting && <Loader2 size={15} strokeWidth={2} className="animate-spin" />}
              {submitting ? 'Sending…' : 'Tell the patient'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
