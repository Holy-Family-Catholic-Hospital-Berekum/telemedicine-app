import { useState } from 'react';
import { X, CheckCircle2, AlertTriangle, Loader2, ShieldAlert } from 'lucide-react';
import { useSiteSettings } from '../../../src/siteSettings';

// Video calls: the doctor can only close as completed. The system marks a
// no-show itself from the call's join records, so a doctor can't mark one
// by mistake for a patient who joined. Hospital visits: completed or
// no-show (the doctor is the one who knows the patient didn't come).
export default function MarkDoneModal({ consultation, onClose, onSubmit }) {
  const inPerson = consultation.mode === 'in_person';
  const [outcome, setOutcome] = useState(inPerson ? null : 'completed'); // 'completed' | 'no_show'
  const [step, setStep] = useState(inPerson ? 'choose' : 'confirm'); // 'choose' | 'confirm'
  const [submitting, setSubmitting] = useState(false);
  const { waitMinutes } = useSiteSettings().settings.noShow;

  async function handleConfirm() {
    setSubmitting(true);
    await onSubmit({ consultation, outcome });
    setSubmitting(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1A1C]/50 p-4">
      <div className="w-full max-w-md rounded-md bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#DCE6EC] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#12242C]">Mark consultation done</h2>
            <p className="text-xs text-[#5C6B72]">{consultation.patient.name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-[#5C6B72] hover:text-[#12242C]">
            <X size={18} />
          </button>
        </div>

        {step === 'choose' && (
          <div className="px-5 py-5">
            <p className="mb-3 text-sm text-[#5C6B72]">Did the patient come to the hospital?</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setOutcome('completed')}
                className="flex flex-col items-start gap-1.5 rounded-md border p-3.5 text-left transition"
                style={
                  outcome === 'completed'
                    ? { borderColor: '#0095D9', backgroundColor: '#0095D90D' }
                    : { borderColor: '#DCE6EC' }
                }
              >
                <CheckCircle2 size={18} strokeWidth={1.75} style={{ color: '#0095D9' }} />
                <span className="text-sm font-medium text-[#12242C]">Completed</span>
                <span className="text-xs text-[#5C6B72]">I saw the patient.</span>
              </button>
              <button
                type="button"
                onClick={() => setOutcome('no_show')}
                className="flex flex-col items-start gap-1.5 rounded-md border p-3.5 text-left transition"
                style={
                  outcome === 'no_show'
                    ? { borderColor: '#F88535', backgroundColor: '#F885350D' }
                    : { borderColor: '#DCE6EC' }
                }
              >
                <AlertTriangle size={18} strokeWidth={1.75} style={{ color: '#F88535' }} />
                <span className="text-sm font-medium text-[#12242C]">No-show</span>
                <span className="text-xs text-[#5C6B72]">The patient didn&apos;t come.</span>
              </button>
            </div>

            {outcome === 'no_show' && (
              <p className="mt-4 text-xs text-[#5C6B72]">
                The patient has {waitMinutes} minutes after the start time to arrive; a no-show can only be
                marked after that. The patient can then book a new time for a fee, or ask for a refund.
              </p>
            )}

            <button
              type="button"
              disabled={!outcome}
              onClick={() => setStep('confirm')}
              className="mt-5 w-full rounded-sm py-2.5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: '#0095D9' }}
            >
              Continue
            </button>
          </div>
        )}

        {step === 'confirm' && (
          <div className="px-5 py-5">
            {!inPerson && (
              <p className="mb-4 text-sm text-[#12242C]">
                Mark this consultation as <span className="font-medium">completed</span>: it took place as
                scheduled.
              </p>
            )}
            <div className="flex gap-3 rounded-md border border-[#DCE6EC] bg-[#F5F8FA] p-3.5">
              <ShieldAlert size={20} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: '#F88535' }} />
              <p className="text-sm text-[#12242C]">
                {outcome === 'no_show'
                  ? "This marks the visit as missed and removes it from your list. The patient's booking is kept for 14 days so they can book a new time or ask for a refund, then its details are deleted."
                  : "This closes the consultation and permanently deletes the patient's booking details (date of birth, sex, location, phone). A short record (doctor, times, amount) is kept. This can't be undone."}
              </p>
            </div>
            {inPerson ? (
              <p className="mt-4 text-sm text-[#5C6B72]">
                Confirm outcome:{' '}
                <span className="font-medium text-[#12242C]">
                  {outcome === 'no_show' ? 'No-show' : 'Completed'}
                </span>
              </p>
            ) : (
              <p className="mt-4 text-xs text-[#5C6B72]">
                Patient didn&apos;t join? You don&apos;t need to do anything: video calls are marked as a
                no-show automatically once the patient&apos;s waiting time is over.
              </p>
            )}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={inPerson ? () => setStep('choose') : onClose}
                disabled={submitting}
                className="flex-1 rounded-sm border border-[#DCE6EC] py-2.5 text-sm font-medium text-[#12242C] transition hover:border-[#0095D9] disabled:opacity-50"
              >
                {inPerson ? 'Back' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={submitting}
                className="flex flex-1 items-center justify-center gap-2 rounded-sm bg-[#B23A3A] py-2.5 text-sm font-medium text-white transition hover:bg-[#96302F] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitting && <Loader2 size={15} strokeWidth={2} className="animate-spin" />}
                {submitting ? 'Saving…' : outcome === 'no_show' ? 'Mark as no-show' : 'Close as completed'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
