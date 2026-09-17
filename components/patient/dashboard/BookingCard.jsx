import { useState } from "react";
import { Clock, CreditCard, ChevronDown, ChevronUp } from "lucide-react";
import {
  formatCurrency,
  formatCountdown,
  formatDateTime,
} from "./PatientUtils";
import PaymentForm from "./PaymentForm";
import RescheduleForm from "./RescheduleForm";
import RevealId from "./RevealId";
import JoinCallPanel from "./JoincallPanel";

// NOTE: JoinCallPanel.jsx (as generated earlier) imports "../utils" and
// "../firestoreService" — one directory up from itself. If every file
// in this set sits flat in components/patient/dashboard/ as you
// described, update those two lines in JoinCallPanel.jsx to "./utils"
// and "./firestoreService" so they resolve correctly.

const STATE_META = {
  awaiting_payment: {
    label: "Awaiting payment",
    color: "#F88535",
    bg: "#F885351A",
  },
  pending_verification: {
    label: "Verifying payment",
    color: "#0095D9",
    bg: "#0095D91A",
  },
  scheduled: { label: "Confirmed", color: "#1E8E5A", bg: "#1E8E5A1A" },
};

export default function BookingCard({
  booking,
  onPaid,
  onRescheduled,
  onJoined,
}) {
  const [expanded, setExpanded] = useState(
    booking.state === "awaiting_payment",
  );
  const meta = STATE_META[booking.state] ?? STATE_META.scheduled;

  return (
    <div className="rounded-md border border-[#DCE6EC] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-[#12242C] text-sm truncate">
              {booking.type}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0"
              style={{ backgroundColor: meta.bg, color: meta.color }}
            >
              {meta.label}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[#5C6B72] truncate">
            {booking.mode === "online" ? "Online" : "In person"} ·{" "}
            {booking.referenceCode}
            {booking.scheduledTime && (
              <> · {formatDateTime(booking.scheduledTime)}</>
            )}
          </p>
        </div>
        {expanded ? (
          <ChevronUp
            size={16}
            strokeWidth={1.75}
            className="shrink-0 text-[#5C6B72]"
          />
        ) : (
          <ChevronDown
            size={16}
            strokeWidth={1.75}
            className="shrink-0 text-[#5C6B72]"
          />
        )}
      </button>

      {expanded && (
        <div className="border-t border-[#DCE6EC] px-4 py-4">
          {booking.state === "awaiting_payment" && (
            <>
              <p className="flex items-center gap-1.5 text-xs text-[#5C6B72]">
                <Clock size={13} strokeWidth={1.75} />
                {formatCountdown(booking.expiresAt)} to pay before this
                reference expires
              </p>
              <PaymentForm booking={booking} onSubmitted={onPaid} />
            </>
          )}

          {booking.state === "pending_verification" && (
            <p className="flex items-center gap-2 text-sm text-[#5C6B72]">
              <CreditCard size={15} strokeWidth={1.75} />
              We're verifying your {formatCurrency(booking.amount)} payment.
              This usually takes a few hours during clinic hours.
            </p>
          )}

          {booking.state === "scheduled" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-[#12242C]">
                  <p className="font-medium">{booking.doctorName}</p>
                  <p className="text-xs text-[#5C6B72]">{booking.department}</p>
                </div>
                <RevealId id={booking.consultationId} />
              </div>
              <JoinCallPanel
                booking={booking}
                onJoined={(bookingId, result) => onJoined?.(bookingId, result)}
              />
              <RescheduleForm booking={booking} onRequested={onRescheduled} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
