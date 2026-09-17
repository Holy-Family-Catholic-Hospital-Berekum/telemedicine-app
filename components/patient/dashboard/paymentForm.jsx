import { useState } from "react";
import { Copy, Check, Loader2 } from "lucide-react";
import { HOSPITAL_MOMO } from "./patientMockData";
import { formatCurrency } from "./patientUtils";
import { submitPayment } from "./patientFirestoreService";

// Same convention as the public booking flow: the reference code we
// generated for this booking IS the transaction reference the patient
// puts in their transfer note — there's no separate free-typed
// "transaction ID" field to get wrong.
export default function PaymentForm({ booking, onSubmitted }) {
  const [momoName, setMomoName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  async function copyRef() {
    try {
      await navigator.clipboard.writeText(booking.referenceCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — patient can still select/copy manually.
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitPayment({
        bookingId: booking.bookingId,
        momoName,
        momoReference: booking.referenceCode,
      });
      onSubmitted?.(booking.bookingId, result);
    } catch (err) {
      setError(err.message || "Could not submit payment. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 rounded-md bg-[#F7FAFB] p-3.5 space-y-3"
    >
      <div className="flex items-center justify-between text-sm">
        <span className="text-[#5C6B72]">Send to</span>
        <span className="text-right">
          <span className="block font-medium text-[#12242C]">
            {HOSPITAL_MOMO.merchantNumber}
          </span>
          <span className="block text-xs text-[#5C6B72]">
            {HOSPITAL_MOMO.network} · {HOSPITAL_MOMO.merchantName}
          </span>
        </span>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-[#5C6B72]">Amount</span>
        <span className="font-medium text-[#12242C]">
          {formatCurrency(booking.amount)}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-[#5C6B72]">Reference (use as transfer note)</span>
        <button
          type="button"
          onClick={copyRef}
          className="flex items-center gap-1 font-mono font-medium text-[#12242C] hover:text-[#0095D9]"
        >
          {booking.referenceCode}
          {copied ? (
            <Check size={13} strokeWidth={2} />
          ) : (
            <Copy size={13} strokeWidth={2} />
          )}
        </button>
      </div>

      <div>
        <label
          htmlFor={`momoName-${booking.bookingId}`}
          className="block text-xs text-[#5C6B72] mb-1"
        >
          Name on the MoMo account used
        </label>
        <input
          id={`momoName-${booking.bookingId}`}
          type="text"
          required
          value={momoName}
          onChange={(e) => setMomoName(e.target.value)}
          className="w-full rounded-sm border border-[#DCE6EC] px-3 py-2 text-sm text-[#12242C] focus:border-[#0095D9] focus:outline-none"
          placeholder="e.g. Ama Serwaa"
        />
      </div>

      {error && <p className="text-xs text-[#B23A3A]">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full flex items-center justify-center gap-2 rounded-sm px-3.5 py-2.5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
        style={{ backgroundColor: "#0095D9" }}
      >
        {submitting && (
          <Loader2 size={14} strokeWidth={2} className="animate-spin" />
        )}
        {submitting ? "Submitting…" : "I've paid — submit for verification"}
      </button>
    </form>
  );
}
