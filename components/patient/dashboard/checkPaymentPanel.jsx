import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { checkPaymentStatus } from "./patientFirestoreService";
import { callableMessage } from "../../../src/constants";

// A payment the patient started that hasn't been confirmed yet (it isn't a
// booking until it is). Asking the server re-checks it with Paystack, so a
// payment that went through late becomes the booking here, instead of the
// patient booking (and paying) a second time. A payment that clearly
// failed is deleted by the server and disappears.
export default function CheckPaymentPanel({ booking, onConfirmed, onFailed }) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState(null);

  async function handleCheck() {
    setChecking(true);
    setMessage(null);
    try {
      const result = await checkPaymentStatus(booking.bookingId);
      if (result.status === "confirmed") {
        onConfirmed?.();
        return;
      }
      if (result.status === "failed") {
        setMessage(result.message || "That payment didn't go through. You can book again.");
        setTimeout(() => onFailed?.(), 2500);
        return;
      }
      setMessage(
        "Not confirmed yet. If you approved it on your phone, wait a minute and check again.",
      );
    } catch (err) {
      setMessage(callableMessage(err, "We couldn't check your payment. Try again."));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <p className="text-sm text-[#3E4E56]">
        You started a payment of {booking.currency || "GHS"} {booking.amount} for a{" "}
        {booking.mode === "online" ? "video call" : "hospital visit"}. If it goes through,
        your booking will appear here and we'll email you. Please don't pay
        again while we check. If it doesn't go through, there is no booking
        and no charge.
      </p>
      <button
        type="button"
        onClick={handleCheck}
        disabled={checking}
        className="flex items-center gap-1.5 rounded-sm px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
        style={{ backgroundColor: "#0095D9" }}
      >
        {checking ? (
          <Loader2 size={13} strokeWidth={2} className="animate-spin" />
        ) : (
          <RefreshCw size={13} strokeWidth={1.75} />
        )}
        {checking ? "Checking…" : "Check payment"}
      </button>
      {message && <p className="text-xs text-[#3E4E56]">{message}</p>}
    </div>
  );
}
