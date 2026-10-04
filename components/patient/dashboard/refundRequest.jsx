import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { requestRefund } from "./patientFirestoreService";
import { callableMessage, toDate } from "../../../src/constants";

// "Request a refund" for a consultation the patient didn't attend, once its
// scheduled day has passed. Deliberately low-key: rescheduling is the
// option the dashboard puts first. The server re-checks eligibility (not
// joined, day passed, money paid, no reschedule pending, one request per
// consultation). Admin refunds manually and marks the outcome.

const STATUS_TEXT = {
  requested: "Refund requested — the hospital will contact you",
  refunded: "Refunded",
  declined: "Refund declined",
};

/** Ghana is UTC+0: compare calendar days in UTC. */
function scheduledDayHasPassed(scheduledTime) {
  const d = toDate(scheduledTime);
  if (!d) return false;
  return d.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10);
}

export default function RefundRequest({ source, id, scheduledTime, amountPaid, existing, defaultPhone, onRequested }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [phone, setPhone] = useState(defaultPhone || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (existing) {
    return (
      <p className="text-xs text-[#5C6B72]">
        {STATUS_TEXT[existing.status] ?? "Refund requested"}
        {existing.status === "declined" && existing.note ? `: ${existing.note}` : ""}
      </p>
    );
  }
  if (!(Number(amountPaid) > 0) || !scheduledDayHasPassed(scheduledTime)) return null;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestRefund({ source, id, reason: reason.trim(), refundPhone: phone.trim() });
      setOpen(false);
      onRequested?.();
    } catch (err) {
      setError(callableMessage(err, "We couldn't send your request. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-[#5C6B72] underline underline-offset-2 hover:text-[#12242C]"
      >
        Request a refund instead
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
          onClick={() => !busy && setOpen(false)}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="refund-title"
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="refund-title" className="text-base font-semibold text-[#12242C]">
                Request a refund
              </h2>
              <button type="button" onClick={() => setOpen(false)} disabled={busy} aria-label="Close">
                <X size={18} className="text-[#5C6B72]" />
              </button>
            </div>
            <p className="mt-2 text-sm text-[#5C6B72]">
              Tell us why you're asking for a refund. The hospital reviews each
              request and refunds approved ones to your mobile money number.
            </p>

            <label className="mt-4 block text-sm font-medium text-[#12242C]" htmlFor="refund-reason">
              Reason
            </label>
            <textarea
              id="refund-reason"
              required
              minLength={5}
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. I couldn't attend because I was unwell"
              className="mt-1 w-full rounded-sm border border-[#DCE6EC] px-3 py-2 text-sm focus:border-[#0095D9] focus:outline-none"
            />

            <label className="mt-3 block text-sm font-medium text-[#12242C]" htmlFor="refund-phone">
              Mobile money number for the refund
            </label>
            <input
              id="refund-phone"
              required
              type="tel"
              inputMode="tel"
              maxLength={20}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 024 123 4567"
              className="mt-1 w-full rounded-sm border border-[#DCE6EC] px-3 py-2 text-sm focus:border-[#0095D9] focus:outline-none"
            />

            {error && <p className="mt-2 text-xs text-[#B23A3A]">{error}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-sm border border-[#DCE6EC] px-4 py-2 text-sm font-medium text-[#12242C]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || reason.trim().length < 5 || phone.trim().length < 9}
                className="flex items-center gap-2 rounded-sm px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: "#0095D9" }}
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                Send request
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
