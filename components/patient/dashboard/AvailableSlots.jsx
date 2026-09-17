import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { PRICING } from "./patientMockData";
import { createBooking } from "./patientFirestoreService";
import { formatDateTime } from "./patientUtils";
import PaymentForm from "./paymentForm";

// Claiming a slot only records intent — per the architecture (4.8) the
// slot itself doesn't move to "held" until payment is actually
// submitted, which is why claiming here drops straight into the same
// PaymentForm used everywhere else rather than a separate confirmation
// step.
export default function AvailableSlots({ slots, onClaimed }) {
  const [claimingId, setClaimingId] = useState(null);
  const [claimedBooking, setClaimedBooking] = useState(null);
  const [form, setForm] = useState({ dateOfBirth: "", sex: "" });
  const [error, setError] = useState(null);

  async function handleClaim(slot) {
    if (!form.dateOfBirth || !form.sex) {
      setError("Enter your date of birth and sex to claim a slot.");
      return;
    }
    setError(null);
    try {
      const booking = await createBooking({
        type: slot.type,
        mode: slot.mode,
        dateOfBirth: form.dateOfBirth,
        sex: form.sex,
        slot,
      });
      const withAmount = { ...booking, amount: PRICING[slot.type] };
      setClaimedBooking(withAmount);
      onClaimed?.(withAmount);
    } catch (err) {
      setError(err.message || "Could not claim this slot.");
    } finally {
      setClaimingId(null);
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
                  onClick={() => setClaimingId(slot.slotId)}
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
                {error && <p className="text-xs text-[#B23A3A]">{error}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleClaim(slot)}
                    className="rounded-sm px-3 py-1.5 text-xs font-medium text-white"
                    style={{ backgroundColor: "#0095D9" }}
                  >
                    Confirm and claim
                  </button>
                  <button
                    type="button"
                    onClick={() => setClaimingId(null)}
                    className="text-xs text-[#5C6B72] hover:text-[#12242C]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {claimedBooking && (
        <div className="mt-3 rounded-md border border-[#F8853533] bg-[#F885350D] p-3.5">
          <p className="text-xs text-[#5C6B72]">
            Slot claimed — pay now to lock it in before it's released back.
          </p>
          <PaymentForm
            booking={claimedBooking}
            onSubmitted={() => setClaimedBooking(null)}
          />
        </div>
      )}
    </div>
  );
}
