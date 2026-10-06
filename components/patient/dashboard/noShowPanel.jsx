import { useState } from "react";
import { CalendarX2, Loader2, RefreshCw } from "lucide-react";

import { callableMessage, formatDateTime } from "../../../src/constants";
import { openPaystackCheckout } from "../../../src/paystackCheckout";
import { startNoShowReschedule, getNoShowFeeStatus } from "./patientFirestoreService";
import RefundRequest from "./refundRequest";

// A missed consultation (booking status "no_show", functions/noShow.js).
// The booking is held until noShowExpiresAt. The patient can:
//   - book a new time: pays the no-show fee fixed when it was marked
//     (booking.noShowTerms.rescheduleFee) through Paystack; the server
//     confirms the payment (webhook or verify) and reopens the booking for
//     the hospital to set the new time. No fee: reopened straight away.
//   - ask for a refund, minus the share kept (noShowTerms.forfeitPercent).
// Rescheduling is the big button; the refund is a small link.

const money = (n) => `GHS ${Number(n || 0).toFixed(2).replace(/\.00$/, "")}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default function NoShowPanel({ booking, refund, defaultPhone, onRefundRequested, onRescheduled }) {
  const terms = booking.noShowTerms ?? {};
  const fee = Number(terms.rescheduleFee || 0);
  const percent = Number(terms.forfeitPercent || 0);
  const paid = Number(booking.amountPaid || 0);
  const back = Math.round(paid * (1 - percent / 100) * 100) / 100;
  const until = booking.noShowExpiresAt;

  const [open, setOpen] = useState(false);
  const [preferredTime, setPreferredTime] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(null); // null | "starting" | "paying" | "checking"
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  // Paystack's popup is only a hint; ask the server until it has confirmed
  // the payment (or ~30 s pass).
  async function confirmFee() {
    setBusy("checking");
    setError(null);
    try {
      for (let i = 0; i < 10; i++) {
        const { status } = await getNoShowFeeStatus(booking.bookingId);
        if (status === "confirmed") {
          setPending(false);
          setDone(true);
          onRescheduled?.();
          return;
        }
        if (status === "failed") {
          setPending(false);
          setError("The payment didn't go through. You weren't charged; try again.");
          return;
        }
        await wait(3000);
      }
      setPending(true);
    } catch (err) {
      setError(callableMessage(err, "We couldn't check your payment. Try again."));
    } finally {
      setBusy(null);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy("starting");
    setError(null);
    try {
      const result = await startNoShowReschedule({
        bookingId: booking.bookingId,
        preferredTime: preferredTime.trim() || undefined,
        reason: reason.trim() || undefined,
      });
      if (result.status === "requested") {
        setDone(true);
        setBusy(null);
        onRescheduled?.();
        return;
      }
      setBusy("paying");
      await openPaystackCheckout(result);
      // Even a closed popup may have been paid (approved on the phone),
      // so ask the server either way.
      await confirmFee();
    } catch (err) {
      setError(callableMessage(err, "We couldn't start the payment. Try again."));
      setBusy(null);
    }
  }

  if (done) {
    return (
      <p className="rounded-md bg-[#1E8E5A]/10 px-4 py-3 text-sm text-[#12242C]">
        {fee > 0 ? "Payment received. " : ""}We'll email you your new appointment time.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-[#B23A3A]/30 bg-[#B23A3A]/5 p-4">
      <p className="flex items-center gap-2 text-base font-semibold text-[#12242C]">
        <CalendarX2 size={18} strokeWidth={1.75} className="text-[#B23A3A]" />
        You missed this appointment
      </p>
      <p className="mt-1 text-sm text-[#3E4E56]">
        {booking.mode === "online"
          ? `You didn't join the video call within ${terms.waitMinutes ?? 5} minutes, so it was marked as missed (a no-show).`
          : "You didn't arrive in time, so it was marked as missed (a no-show)."}
        {booking.doctorName ? ` Doctor: ${booking.doctorName}.` : ""}
      </p>

      {refund ? (
        <div className="mt-3">
          <RefundRequest existing={refund} />
        </div>
      ) : (
        <>
          {until && (
            <p className="mt-2 text-sm font-medium text-[#12242C]">
              Choose what to do by {formatDateTime(until)}. After that the
              booking closes and its details are deleted.
            </p>
          )}

          <div className="mt-3">
            {!open ? (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 sm:w-auto"
                style={{ backgroundColor: "#0095D9" }}
              >
                <RefreshCw size={16} strokeWidth={2} />
                {fee > 0 ? `Book a new time (${money(fee)} fee)` : "Book a new time"}
              </button>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-2.5 rounded-md border border-[#DCE6EC] bg-white p-3.5">
                <p className="text-sm text-[#3E4E56]">
                  {fee > 0
                    ? `There's an extra fee of ${money(fee)} to book a new time after a missed appointment. Pay it with mobile money and we'll email you the new time.`
                    : "Tell us when suits you and we'll email you the new time."}
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
                  placeholder="Anything we should know? (optional)"
                  rows={2}
                  className="w-full rounded-sm border border-[#DCE6EC] px-3 py-2 text-sm text-[#12242C] focus:border-[#0095D9] focus:outline-none"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={Boolean(busy)}
                    className="flex items-center gap-1.5 rounded-sm px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ backgroundColor: "#0095D9" }}
                  >
                    {busy && <Loader2 size={14} strokeWidth={2} className="animate-spin" />}
                    {busy === "checking"
                      ? "Confirming payment…"
                      : busy
                        ? "Opening payment…"
                        : fee > 0
                          ? `Pay ${money(fee)} and send`
                          : "Send request"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={Boolean(busy)}
                    className="text-sm text-[#3E4E56] hover:text-[#12242C]"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>

          {pending && (
            <div className="mt-3 text-sm text-[#3E4E56]">
              We haven't had confirmation of your payment yet. If you approved
              it on your phone, it can take a minute.{" "}
              <button
                type="button"
                onClick={() => confirmFee()}
                disabled={Boolean(busy)}
                className="font-medium text-[#0B6BA0] underline underline-offset-2"
              >
                Check again
              </button>
            </div>
          )}
          {error && <p className="mt-2 text-sm text-[#B23A3A]">{error}</p>}

          {paid > 0 && (
            <div className="mt-3">
              <RefundRequest
                source="booking"
                id={booking.bookingId}
                amountPaid={paid}
                suggestedAmount={back}
                forfeitPercent={percent}
                anyTime
                defaultPhone={defaultPhone}
                onRequested={onRefundRequested}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
