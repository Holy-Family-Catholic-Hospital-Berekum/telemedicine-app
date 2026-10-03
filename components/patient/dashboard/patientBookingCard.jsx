import { useState } from "react";
import { ShieldCheck, ChevronDown, ChevronUp, Video } from "lucide-react";

import { formatCurrency } from "./patientUtils";
import { TYPE_LABELS, MODE_LABELS, formatDateTime } from "../../../src/constants";
import RescheduleForm from "./rescheduleForm";
import RevealId from "./revealId";
import JoinCallPanel from "./joinCallPanel";

const STATE_META = {
  awaiting_payment: {
    label: "Not paid",
    color: "#A85420",
    bg: "#F885351A",
  },
  pending_assignment: {
    label: "Payment confirmed",
    color: "#0095D9",
    bg: "#0095D91A",
  },
  scheduled: {
    label: "Confirmed",
    color: "#1E8E5A",
    bg: "#1E8E5A1A",
  },
  in_progress: {
    label: "In progress",
    color: "#F88535",
    bg: "#F885351A",
  },
};

export default function BookingCard({
  booking,
  onRescheduled,
  onJoined,
  onRejoinCall,
}) {
  const [expanded, setExpanded] = useState(
    booking.state === "pending_assignment",
  );

  const meta = STATE_META[booking.state] ?? STATE_META.scheduled;

  const isScheduled =
    booking.state === "scheduled" || booking.state === "in_progress";
  const callInProgress =
    booking.mode === "online" && booking.state === "in_progress";

  return (
    <div className="rounded-md border border-[#DCE6EC] overflow-hidden">
      <div className="w-full flex items-center justify-between gap-3 px-4 py-3.5">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-[#12242C] text-sm truncate">
              {TYPE_LABELS[booking.type] ?? booking.type}
            </span>

            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0"
              style={{
                backgroundColor: meta.bg,
                color: meta.color,
              }}
            >
              {meta.label}
            </span>
          </div>

          <p className="mt-0.5 text-xs text-[#5C6B72] truncate">
            {MODE_LABELS[booking.mode] ?? booking.mode}

            {booking.scheduledTime && (
              <>
                {" · "}
                {formatDateTime(booking.scheduledTime)}
              </>
            )}
          </p>
        </button>

        <div className="flex items-center gap-2 shrink-0">
          {callInProgress && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRejoinCall?.(booking);
              }}
              className="flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-95 active:brightness-90"
              style={{ backgroundColor: "#1E8E5A" }}
            >
              <Video size={13} strokeWidth={2} />
              Rejoin call
            </button>
          )}

          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? "Collapse" : "Expand"}
            className="text-[#5C6B72]"
          >
            {expanded ? (
              <ChevronUp size={16} strokeWidth={1.75} />
            ) : (
              <ChevronDown size={16} strokeWidth={1.75} />
            )}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#DCE6EC] px-4 py-4">
          {booking.state === "awaiting_payment" && (
            <p className="text-sm text-[#5C6B72]">
              This booking wasn't paid for, so it isn't confirmed. Unpaid
              bookings and their details are deleted after 24 hours. Start a
              new booking to try again.
            </p>
          )}

          {booking.state === "pending_assignment" && (
            <p className="flex items-center gap-2 text-sm text-[#5C6B72]">
              <ShieldCheck size={15} strokeWidth={1.75} />
              Paid {formatCurrency(booking.amountPaid ?? booking.amount)} · we're assigning your
              doctor and appointment time. You'll hear from us by phone or
              WhatsApp shortly.
            </p>
          )}

          {isScheduled && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-[#12242C]">
                  <p className="font-medium">{booking.doctorName}</p>

                  <p className="text-xs text-[#5C6B72]">{booking.doctorDepartment}</p>
                </div>

                <RevealId id={booking.consultationId} />
              </div>

              {booking.mode === "online" ? (
                <JoinCallPanel
                  booking={booking}
                  onJoined={(bookingId, result) => onJoined?.(bookingId, result)}
                />
              ) : (
                <p className="text-sm text-[#5C6B72]">
                  Please come to the hospital at your appointment time.
                </p>
              )}

              {booking.state === "scheduled" &&
                (booking.rescheduleRequest?.status === "requested" ? (
                  <p className="text-xs text-[#5C6B72]">
                    Reschedule requested — we'll confirm by phone or WhatsApp.
                  </p>
                ) : (
                  <RescheduleForm booking={booking} onRequested={onRescheduled} />
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
