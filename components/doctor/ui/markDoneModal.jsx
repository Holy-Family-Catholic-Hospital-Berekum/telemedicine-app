import { useState } from 'react';
import { X, CheckCircle2, AlertTriangle, Loader2, ShieldAlert } from 'lucide-react';

export default function MarkDoneModal({ consultation, onClose, onSubmit }) {
  const [outcome, setOutcome] = useState(null); // 'completed' | 'no_show'
  const [step, setStep] = useState('choose'); // 'choose' | 'confirm'
  const [submitting, setSubmitting] = useState(false);

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
            <p className="mb-3 text-sm text-[#5C6B72]">How did this consultation go?</p>
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
                <span className="text-xs text-[#5C6B72]">The consultation happened as scheduled.</span>
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
                <span className="text-xs text-[#5C6B72]">The patient did not attend.</span>
              </button>
            </div>

            {outcome === 'no_show' && (
              <p className="mt-4 text-xs text-[#5C6B72]">
                Any refund or forfeit is handled automatically by reception — nothing further needed from you.
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
            <div className="flex gap-3 rounded-md border border-[#DCE6EC] bg-[#F5F8FA] p-3.5">
              <ShieldAlert size={20} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: '#F88535' }} />
              <p className="text-sm text-[#12242C]">
                This closes the consultation and permanently deletes the patient's booking details (date of
                birth, sex, location, phone). A short record (doctor, times, amount) is kept. This can't be undone.
              </p>
            </div>
            <p className="mt-4 text-sm text-[#5C6B72]">
              Confirm outcome:{' '}
              <span className="font-medium text-[#12242C]">
                {outcome === 'no_show' ? 'No-show' : 'Completed'}
              </span>
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setStep('choose')}
                disabled={submitting}
                className="flex-1 rounded-sm border border-[#DCE6EC] py-2.5 text-sm font-medium text-[#12242C] transition hover:border-[#0095D9] disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={submitting}
                className="flex flex-1 items-center justify-center gap-2 rounded-sm bg-[#B23A3A] py-2.5 text-sm font-medium text-white transition hover:bg-[#96302F] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitting && <Loader2 size={15} strokeWidth={2} className="animate-spin" />}
                {submitting ? 'Closing…' : 'Close consultation'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
