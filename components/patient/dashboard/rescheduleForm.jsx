import { useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { requestReschedule } from "./patientFirestoreService";

export default function RescheduleForm({ booking, onRequested }) {
  const [open, setOpen] = useState(false);
  const [consultationId, setConsultationId] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await requestReschedule({
        booking,
        consultationId,
        preferredTime,
        reason,
      });
      setDone(true);
      onRequested?.(booking.bookingId, result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <p className="text-xs text-[#5C6B72]">
        Reschedule request sent — we'll confirm by phone or WhatsApp.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-sm px-3 py-2 text-xs font-medium text-white transition hover:brightness-95 active:brightness-90"
        style={{ backgroundColor: "#0095D9" }}
      >
        <RefreshCw size={13} strokeWidth={1.75} />
        Request reschedule
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-[#DCE6EC] p-3.5 space-y-2.5"
    >
      <p className="text-xs text-[#5C6B72]">
        Confirm your consultation ID to request a reschedule.
      </p>
      <input
        type="text"
        required
        value={consultationId}
        onChange={(e) => setConsultationId(e.target.value)}
        placeholder="e.g. CID-7X29K4"
        className="w-full rounded-sm border border-[#DCE6EC] px-3 py-2 text-sm font-mono uppercase text-[#12242C] focus:border-[#0095D9] focus:outline-none"
      />
      <input
        type="text"
        value={preferredTime}
        onChange={(e) => setPreferredTime(e.target.value)}
        placeholder="Preferred new time (optional)"
        className="w-full rounded-sm border border-[#DCE6EC] px-3 py-2 text-sm text-[#12242C] focus:border-[#0095D9] focus:outline-none"
      />
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
        rows={2}
        className="w-full rounded-sm border border-[#DCE6EC] px-3 py-2 text-sm text-[#12242C] focus:border-[#0095D9] focus:outline-none"
      />
      {error && <p className="text-xs text-[#B23A3A]">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex items-center gap-1.5 rounded-sm px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          style={{ backgroundColor: "#0095D9" }}
        >
          {submitting && (
            <Loader2 size={13} strokeWidth={2} className="animate-spin" />
          )}
          Send request
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-[#5C6B72] hover:text-[#12242C]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
