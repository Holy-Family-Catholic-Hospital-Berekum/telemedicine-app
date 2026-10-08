import { useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { requestReschedule, getNoShowFeeStatus } from "./patientFirestoreService";
import { callableMessage } from "../../../src/constants";
import { useSiteSettings } from "../../../src/siteSettings";
import { openPaystackCheckout } from "../../../src/paystackCheckout";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Mirrors rescheduleCountsAsNoShow (functions/lib/consultationLifecycle.js):
// a patient asking for a new time while the doctor is waiting for them in
// the video room (or after the start of a hospital visit) pays the no-show
// fee. Only for the wording; the server decides.
function isLate(booking, now = Date.now()) {
  const start = booking.scheduledTime?.getTime?.();
  if (!start || now < start || booking.metAt) return false;
  if (booking.rescheduleRequest?.status === "requested") return false;
  if (booking.mode === "online") return booking.waitDeadline?.for === "patient";
  return true;
}

export default function RescheduleForm({ booking, onRequested }) {
  const { noShow } = useSiteSettings().settings;
  const [open, setOpen] = useState(false);
  const [preferredTime, setPreferredTime] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [paying, setPaying] = useState(false);
  const late = isLate(booking);
  const fee = Number(noShow.rescheduleFee || 0);

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
      if (result?.status === "pay") {
        // Too late for a free reschedule: it now counts as missed and the
        // no-show fee is due. Paystack's answer is only a hint; ask the
        // server. Unconfirmed? The booking card offers to pay again.
        setPaying(true);
        await openPaystackCheckout(result);
        for (let i = 0; i < 10; i++) {
          const { status } = await getNoShowFeeStatus(booking.bookingId);
          if (status !== "pending") break;
          await wait(3000);
        }
      }
      setDone(true);
      onRequested?.(booking.bookingId, result);
    } catch (err) {
      setError(callableMessage(err, "We couldn't send your request."));
      onRequested?.(booking.bookingId, null); // the booking may have changed
    } finally {
      setSubmitting(false);
      setPaying(false);
    }
  }

  if (done) {
    return (
      <p className="text-xs text-[#3E4E56]">
        Request sent. We'll email you your new time.
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
        {late && fee > 0 ? `Change appointment time (GHS ${fee} fee)` : "Change appointment time"}
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-[#DCE6EC] p-3.5 space-y-2.5"
    >
      {late ? (
        <p className="rounded-sm bg-[#F88535]/10 px-3 py-2 text-sm text-[#12242C]">
          Your appointment time has started, so moving it now counts as a
          missed appointment
          {fee > 0
            ? ` and costs an extra GHS ${fee}, paid with mobile money.`
            : "."}{" "}
          We'll email you the new time.
        </p>
      ) : (
        <p className="text-xs text-[#3E4E56]">
          Tell us when suits you and we'll email you the new time.
        </p>
      )}
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
          {paying
            ? "Confirming payment…"
            : late && fee > 0
              ? `Pay GHS ${fee} and send`
              : "Send request"}
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
