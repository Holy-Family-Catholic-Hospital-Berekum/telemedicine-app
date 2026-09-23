import { useState } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { createBooking } from "./patientFirestoreService";
import { formatDateTime } from "./patientUtils";

// UPDATED for the new payment flow (Paystack, server-confirmed on the
// booking page — see bookConsultation.jsx): claiming a slot is now a
// single step. createBooking() itself takes the patient through payment
// (same as bookConsultation.jsx) and only resolves once payment is
// confirmed, so there's no separate PaymentForm step afterward and no
// unpaid/pending-verification state to hold here.
//
// location is now collected up front, same field bookConsultation.jsx
// gathers before payment.
export default function AvailableSlots({ slots, onClaimed }) {
  const [claimingId, setClaimingId] = useState(null);
  const [submittingId, setSubmittingId] = useState(null);
  const [form, setForm] = useState({ dateOfBirth: "", sex: "", location: "" });
  const [error, setError] = useState(null);

  async function handleClaim(slot) {
    if (!form.dateOfBirth || !form.sex || !form.location.trim()) {
      setError("Enter your date of birth, sex, and location to claim a slot.");
      return;
    }
    setError(null);
    setSubmittingId(slot.slotId);
    try {
      const booking = await createBooking({
        type: slot.type,
        mode: slot.mode,
        dateOfBirth: form.dateOfBirth,
        sex: form.sex,
        location: form.location.trim(),
        slot,
      });
      onClaimed?.(booking);
      setClaimingId(null);
      setForm({ dateOfBirth: "", sex: "", location: "" });
    } catch (err) {
      setError(err.message || "Could not claim this slot.");
    } finally {
      setSubmittingId(null);
    }
  }

  if (!slots?.length) return null;

  return (
    <div>
      <h3 className="text-sm font-medium text-[#12242C]">
        Open slots you can claim directly
      </h3>
      <div className="mt-2 space-y-2">
        {slots.map((slot) => (
          <div
            key={slot.slotId}
            className="rounded-md border border-[#DCE6EC] p-3.5"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-medium text-[#12242C]">{slot.doctorName}</p>
                <p className="text-xs text-[#5C6B72]">
                  {slot.type} ·{" "}
                  {slot.mode === "online" ? "Online" : "In person"} ·{" "}
                  {formatDateTime(`${slot.date}T${slot.startTime}`)}
                </p>
              </div>
              {claimingId !== slot.slotId && (
                <button
                  type="button"
                  onClick={() => {
                    setClaimingId(slot.slotId);
                    setError(null);
                  }}
                  className="flex items-center gap-1.5 rounded-sm border border-[#0095D9] px-3 py-1.5 text-xs font-medium text-[#0095D9] hover:bg-[#0095D90D] transition"
                >
                  <CalendarPlus size={13} strokeWidth={1.75} />
                  Claim
                </button>
              )}
            </div>

            {claimingId === slot.slotId && (
              <div className="mt-3 space-y-2 border-t border-[#DCE6EC] pt-3">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    required
                    value={form.dateOfBirth}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, dateOfBirth: e.target.value }))
                    }
                    className="rounded-sm border border-[#DCE6EC] px-2.5 py-1.5 text-xs text-[#12242C] focus:border-[#0095D9] focus:outline-none"
                  />
                  <select
                    required
                    value={form.sex}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, sex: e.target.value }))
                    }
                    className="rounded-sm border border-[#DCE6EC] px-2.5 py-1.5 text-xs text-[#12242C] focus:border-[#0095D9] focus:outline-none"
                  >
                    <option value="">Sex</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </select>
                </div>
                <input
                  type="text"
                  required
                  value={form.location}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, location: e.target.value }))
                  }
                  placeholder="Location (town/area)"
                  className="w-full rounded-sm border border-[#DCE6EC] px-2.5 py-1.5 text-xs text-[#12242C] focus:border-[#0095D9] focus:outline-none"
                />
                {error && <p className="text-xs text-[#B23A3A]">{error}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleClaim(slot)}
                    disabled={submittingId === slot.slotId}
                    className="flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ backgroundColor: "#0095D9" }}
                  >
                    {submittingId === slot.slotId && (
                      <Loader2
                        size={13}
                        strokeWidth={2}
                        className="animate-spin"
                      />
                    )}
                    {submittingId === slot.slotId
                      ? "Processing payment…"
                      : "Confirm and pay"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setClaimingId(null);
                      setError(null);
                    }}
                    disabled={submittingId === slot.slotId}
                    className="text-xs text-[#5C6B72] hover:text-[#12242C] disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
