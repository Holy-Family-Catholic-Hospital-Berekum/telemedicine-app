import { useState } from "react";
import { ShieldCheck, ChevronDown, ChevronUp, Video, CalendarX2 } from "lucide-react";

import { formatCurrency, getCallWindow } from "./patientUtils";
import { TYPE_LABELS, MODE_LABELS, formatDateTime } from "../../../src/constants";
import RescheduleForm from "./rescheduleForm";
import RevealId from "./revealId";
import JoinCallPanel from "./joinCallPanel";
import CheckPaymentPanel from "./checkPaymentPanel";
import RefundRequest from "./refundRequest";
import NoShowPanel from "./noShowPanel";

const STATE_META = {
  awaiting_payment: {
    label: "Payment not confirmed",
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
  no_show: {
    label: "Missed",
    color: "#B23A3A",
    bg: "#B23A3A14",
  },
};

const MISSED_META = {
  label: "Didn't take place",
  color: "#A85420",
  bg: "#F885351A",
};

export default function BookingCard({
  booking,
  onRescheduled,
  onJoined,
  onRejoinCall,
  onPaymentConfirmed,
  refund,
  defaultPhone,
  onRefundRequested,
  onNoShowRescheduled,
}) {
  const isScheduled =
    booking.state === "scheduled" || booking.state === "in_progress";

  // A consultation that didn't take place (the time is well past and the
  // patient, or the doctor, never joined) is offered a reschedule first;
  // a refund only if the patient didn't join. In person, the doctor closes
  // the visit once it happens, so one still open hours after its time
  // counts as missed.
  const patientJoined = Boolean(booking.patientJoinedAt);
  const bothJoined = patientJoined && Boolean(booking.doctorJoinedAt);
  const { closed } = getCallWindow(booking.scheduledTime);
  const didNotHappen =
    isScheduled && closed && (booking.mode === "online" ? !bothJoined : true);
  const rescheduleRequested = booking.rescheduleRequest?.status === "requested";

  const callInProgress =
    booking.mode === "online" && booking.state === "in_progress" && !closed;

  // Open by default so the main action (join, reschedule, check payment)
  // is on screen without hunting for it.
  const [expanded, setExpanded] = useState(true);

  const meta =
    didNotHappen && !refund && !rescheduleRequested
      ? MISSED_META
      : (STATE_META[booking.state] ?? STATE_META.scheduled);

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
              className="rounded-full px-2 py-0.5 text-[14px] font-medium shrink-0"
              style={{
                backgroundColor: meta.bg,
                color: meta.color,
              }}
            >
              {meta.label}
            </span>
          </div>

          <p className="mt-0.5 text-xs text-[#3E4E56] truncate">
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
            className="text-[#3E4E56]"
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
            <CheckPaymentPanel booking={booking} onConfirmed={onPaymentConfirmed} />
          )}

          {booking.state === "no_show" && (
            <NoShowPanel
              booking={booking}
              refund={refund}
              defaultPhone={defaultPhone}
              onRefundRequested={onRefundRequested}
              onRescheduled={onNoShowRescheduled}
            />
          )}

          {booking.state === "pending_assignment" && (
            <p className="flex items-center gap-2 text-sm text-[#3E4E56]">
              <ShieldCheck size={15} strokeWidth={1.75} />
              Paid {formatCurrency(booking.amountPaid ?? booking.amount)} · we're assigning your
              doctor and appointment time. We'll email you the time and your
              consultation ID shortly.
            </p>
          )}

          {isScheduled && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-[#12242C]">
                  <p className="font-medium">{booking.doctorName}</p>

                  <p className="text-xs text-[#3E4E56]">{booking.doctorDepartment}</p>
                </div>

                <RevealId id={booking.consultationId} />
              </div>

              {refund ? (
                // A refund request ends the booking's options.
                <RefundRequest existing={refund} />
              ) : rescheduleRequested ? (
                <p className="text-sm text-[#3E4E56]">
                  Reschedule requested — we'll email you the new time.
                </p>
              ) : didNotHappen ? (
                <div className="rounded-md border border-[#F88535]/40 bg-[#F88535]/5 p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-[#12242C]">
                    <CalendarX2 size={16} strokeWidth={1.75} className="text-[#A85420]" />
                    {patientJoined
                      ? "Your doctor couldn't join this consultation"
                      : "You missed this appointment"}
                  </p>
                  <p className="mt-1 text-sm text-[#3E4E56]">
                    {patientJoined
                      ? "Sorry about that. Choose a new time and we'll book you in again at no extra cost."
                      : "Choose a new time and we'll book you in again."}
                  </p>
                  <div className="mt-3">
                    <RescheduleForm booking={booking} onRequested={onRescheduled} />
                  </div>
                  {!patientJoined && (
                    <div className="mt-3">
                      <RefundRequest
                        source="booking"
                        id={booking.bookingId}
                        scheduledTime={booking.scheduledTime}
                        amountPaid={booking.amountPaid}
                        defaultPhone={defaultPhone}
                        onRequested={onRefundRequested}
                      />
                    </div>
                  )}
                </div>
              ) : bothJoined && closed ? (
                <p className="text-sm text-[#3E4E56]">
                  Your consultation has taken place. It will move to your
                  history once the doctor closes it.
                </p>
              ) : (
                <>
                  {booking.mode === "online" ? (
                    <JoinCallPanel
                      booking={booking}
                      onJoined={(bookingId, result) => onJoined?.(bookingId, result)}
                    />
                  ) : (
                    <p className="text-sm text-[#3E4E56]">
                      Please come to the hospital at your appointment time.
                    </p>
                  )}

                  {!bothJoined && (
                    <div className="border-t border-[#DCE6EC] pt-4">
                      <p className="mb-2 text-xs text-[#3E4E56]">
                        Can't make this time?
                      </p>
                      <RescheduleForm booking={booking} onRequested={onRescheduled} />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
