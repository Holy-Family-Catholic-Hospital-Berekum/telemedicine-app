import { useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { requestReschedule } from "./patientFirestoreService";
import { callableMessage } from "../../../src/constants";

export default function RescheduleForm({ booking, onRequested }) {
  const [open, setOpen] = useState(false);
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
        preferredTime,
        reason,
      });
      setDone(true);
      onRequested?.(booking.bookingId, result);
    } catch (err) {
      setError(callableMessage(err, "We couldn't send your request."));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <p className="text-xs text-[#3E4E56]">
        Reschedule request sent — we'll email you the new time.
      </p>
    );
  }

  // The main way to deal with an appointment the patient can't make (or
  // missed): kept large and obvious; the refund link is deliberately small.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 active:brightness-90 sm:w-auto"
        style={{ backgroundColor: "#0095D9" }}
      >
        <RefreshCw size={16} strokeWidth={2} />
        Reschedule appointment
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-[#DCE6EC] p-3.5 space-y-2.5"
    >
      <p className="text-xs text-[#3E4E56]">
        Tell us when suits you and we'll email you the new time.
      </p>
      <input
        type="text"
        maxLength={80}
        value={preferredTime}
        onChange={(e) => setPreferredTime(e.target.value)}
        placeholder="Preferred new time (optional)"
        className="w-full rounded-sm border border-[#DCE6EC] px-3 py-2 text-sm text-[#12242C] focus:border-[#0095D9] focus:outline-none"
      />
      <textarea
        maxLength={300}
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
          className="text-xs text-[#3E4E56] hover:text-[#12242C]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
