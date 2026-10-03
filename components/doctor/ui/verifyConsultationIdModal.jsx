import { useState } from "react";
import { KeyRound, X, Loader2 } from "lucide-react";

// Prompts the doctor for the consultation ID before a call is allowed to
// start. `onVerify` sends it to the server and resolves { ok, message }.
export default function VerifyConsultationIdModal({ onClose, onVerify }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!value.trim() || submitting) return;
    setSubmitting(true);
    const result = await onVerify(value.trim());
    setSubmitting(false);
    if (!result?.ok) setError(result?.message || "That ID doesn't match this session.");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-md bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[#12242C]">
            <KeyRound
              size={16}
              strokeWidth={1.75}
              style={{ color: "#0095D9" }}
            />
            Enter consultation ID
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[#5C6B72] hover:text-[#12242C]"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <p className="mt-2 text-xs text-[#5C6B72]">
          Get this ID from admin/reception in the telemedicine room before
          joining this call.
        </p>
        <form onSubmit={handleSubmit} className="mt-4">
          <input
            autoFocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            placeholder="e.g. HFC-XXXXXXXXXX"
            className="w-full rounded-sm border px-3 py-2 text-sm font-mono uppercase tracking-wide outline-none"
            style={{ borderColor: error ? "#D64545" : "#DCE6EC" }}
          />
          {error && (
            <p className="mt-1.5 text-xs" style={{ color: "#D64545" }}>
              {error} Confirm it with admin and try again.
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm border border-[#DCE6EC] px-3.5 py-2 text-sm font-medium text-[#12242C]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || value.trim().length === 0}
              className="flex items-center gap-2 rounded-sm px-3.5 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              style={{ backgroundColor: "#0095D9" }}
            >
              {submitting && (
                <Loader2 size={14} strokeWidth={2} className="animate-spin" />
              )}
              {submitting ? "Joining…" : "Join call"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
