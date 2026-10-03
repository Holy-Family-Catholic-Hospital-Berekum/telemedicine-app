import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { checkPaymentStatus } from "./patientFirestoreService";
import { callableMessage } from "../../../src/constants";

// Shown on a booking whose payment hasn't been confirmed. Asking the server
// re-checks every payment attempt with Paystack, so a payment that went
// through late is picked up here instead of the patient booking (and
// paying) a second time.
export default function CheckPaymentPanel({ booking, onConfirmed }) {
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
      setMessage(
        result.status === "failed"
          ? result.message || "That payment didn't complete."
          : "Your payment hasn't been confirmed yet. If you approved it on your phone, wait a minute and check again.",
      );
    } catch (err) {
      setMessage(callableMessage(err, "We couldn't check your payment. Try again."));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <p className="text-sm text-[#5C6B72]">
        We haven't confirmed a payment for this booking yet. If you paid,
        check it here — please don't book and pay again. Unpaid bookings and
        their details are deleted after 24 hours.
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
      {message && <p className="text-xs text-[#5C6B72]">{message}</p>}
    </div>
  );
}
