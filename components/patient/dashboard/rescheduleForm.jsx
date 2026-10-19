import { useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { requestReschedule, getNoShowFeeStatus } from "./patientFirestoreService";
import { callableMessage, formatTime } from "../../../src/constants";
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

// Mirrors rescheduleNeedsLateFee (functions/lib/consultationLifecycle.js):
// free up to 24 hours before the start; after that, until the start, the
// reschedule fee. The appointment stays booked until it's paid. A time
// given less than 24 hours ahead is free to change for its first hour.
const FREE_RESCHEDULE_HOURS = 24;
const SHORT_NOTICE_FREE_MINUTES = 60;
function freeChangeUntil(booking) {
  const start = booking.scheduledTime?.getTime?.();
  const setAt = booking.scheduleSetAt?.getTime?.();
  if (!start || !setAt || start - setAt >= FREE_RESCHEDULE_HOURS * 3600 * 1000) return null;
  return new Date(setAt + SHORT_NOTICE_FREE_MINUTES * 60 * 1000);
}
function inFreeHour(booking, now = Date.now()) {
  const until = freeChangeUntil(booking);
  return Boolean(until) && now < until.getTime();
}
function needsLateFee(booking, now = Date.now()) {
  const start = booking.scheduledTime?.getTime?.();
  if (!start || now >= start || booking.metAt) return false;
  if (booking.payAtHospital || booking.doctorUnavailable) return false;
  if (booking.rescheduleRequest?.status === "requested") return false;
  if (inFreeHour(booking, now)) return false;
  return start - now < FREE_RESCHEDULE_HOURS * 3600 * 1000;
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
  // The late fee wasn't confirmed: the appointment is still booked.
  const [notPaid, setNotPaid] = useState(false);
  const late = isLate(booking);
  const fee = Number(noShow.rescheduleFee || 0);
  const lateFee = !late && fee > 0 && needsLateFee(booking);
  const charged = (late || lateFee) && fee > 0;
  // A short-notice time still in its free first hour.
  const freeUntil = !late && fee > 0 && inFreeHour(booking) ? freeChangeUntil(booking) : null;

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotPaid(false);
    try {
      const result = await requestReschedule({
        booking,
        preferredTime,
        reason,
      });
      if (result?.status === "pay") {
        // A fee is due: less than 24 hours before (the appointment stays
        // booked until it's paid), or after the start (it now counts as
        // missed). Paystack's answer is only a hint; ask the server.
        setPaying(true);
        await openPaystackCheckout(result);
        let status = "pending";
        for (let i = 0; i < 10; i++) {
          ({ status } = await getNoShowFeeStatus(booking.bookingId));
          if (status !== "pending") break;
          await wait(3000);
        }
        if (lateFee && status !== "confirmed") {
          // Nothing changed: no request was sent and the time still stands.
          setNotPaid(true);
          return;
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
        {charged ? `Change appointment time (GHS ${fee} fee)` : "Change appointment time"}
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-[#DCE6EC] p-3.5 space-y-2.5"
    >
      {lateFee ? (
        <p className="rounded-sm bg-[#F88535]/10 px-3 py-2 text-sm text-[#12242C]">
          Your appointment is less than {FREE_RESCHEDULE_HOURS} hours away, so changing the time
          costs GHS {fee}, paid with mobile money. Your appointment stays booked until the payment
          goes through. We&apos;ll email you the new time.
        </p>
      ) : late ? (
        <p className="rounded-sm bg-[#F88535]/10 px-3 py-2 text-sm text-[#12242C]">
          Your appointment time has started, so moving it now counts as a
          missed appointment
          {fee > 0
            ? ` and costs an extra GHS ${fee}, paid with mobile money.`
            : "."}{" "}
          We'll email you the new time.
        </p>
      ) : freeUntil ? (
        <p className="text-xs text-[#3E4E56]">
          Your appointment is less than {FREE_RESCHEDULE_HOURS} hours away, but it was only just
          booked, so you can change it free of charge until {formatTime(freeUntil)}. Tell us when
          suits you and we&apos;ll email you the new time.
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
      {notPaid && (
        <p className="text-sm text-[#B23A3A]">
          We didn&apos;t receive the GHS {fee} payment, so your appointment time hasn&apos;t changed.
          If money left your account, wait a minute and tap the button again: we&apos;ll find it.
        </p>
      )}
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
            : charged
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
