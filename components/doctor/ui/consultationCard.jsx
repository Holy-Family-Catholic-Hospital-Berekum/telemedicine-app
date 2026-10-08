import { useState } from "react";
import {
  Video,
  MapPin,
  Lock,
  PhoneCall,
  CheckSquare,
  History,
  Loader2,
  CalendarX2,
} from "lucide-react";
import SensitiveDetails from "../sensitiveDetails";
import { getCallWindow } from "../docUtils";
import { TYPE_LABELS, formatTime, formatDateTime } from "../../../src/constants";

const MODE_STYLE = {
  online: { spine: "#0095D9", chipText: "#0095D9", label: "Online" },
  in_person: { spine: "#F88535", chipText: "#F88535", label: "In person" },
};

export default function ConsultationCard({
  consultation,
  onStartCall,
  onMarkDone,
  onCantMakeIt,
  inRoom,
  // Upcoming (not today): show the date with the time.
  showDate = false,
}) {
  const [expandedHistory, setExpandedHistory] = useState(false);
  const mode = MODE_STYLE[consultation.mode] ?? MODE_STYLE.in_person;
  const isOnline = consultation.mode === "online";
  const callInProgress = isOnline && consultation.status === "in_progress";
  const { unlocked, minutesUntilUnlock } = getCallWindow(
    consultation.scheduledTime,
  );

  const [callError, setCallError] = useState(null);
  const [starting, setStarting] = useState(false);

  // One click on the telemedicine room computer: startVideoCall checks the
  // computer's room key, that this doctor is assigned and the time window.
  // On any other device the button is disabled and the server refuses too.
  async function handleStart() {
    setStarting(true);
    setCallError(null);
    const result = await onStartCall(consultation.consultationId);
    setStarting(false);
    if (!result.ok) setCallError(result.message);
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-[#DCE6EC] bg-white md:flex-row">
      <div
        className="h-1.5 w-full shrink-0 md:h-auto md:w-1.5"
        style={{ backgroundColor: mode.spine }}
        aria-hidden="true"
      />

      <div className="flex-1 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm text-[#5C6B72]">
              <span className="font-medium text-[#12242C]">
                {showDate
                  ? formatDateTime(consultation.scheduledTime)
                  : formatTime(consultation.scheduledTime)}
              </span>
              <span>·</span>
              <span>{TYPE_LABELS[consultation.type] ?? consultation.type}</span>
              <span
                className="rounded-sm px-1.5 py-0.5 text-xs"
                style={{
                  backgroundColor: `${mode.spine}1A`,
                  color: mode.chipText,
                }}
              >
                {mode.label}
              </span>
              {callInProgress && (
                <span
                  className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs"
                  style={{ backgroundColor: "#F885351A", color: "#F88535" }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: "#F88535" }}
                  />{" "}
                  Call live
                </span>
              )}
            </div>
            <h3 className="mt-1 text-base font-semibold text-[#12242C]">
              {consultation.patient.name}
            </h3>
            {consultation.patient.guardianName && (
              <p className="text-sm text-[#5C6B72]">
                Child · parent/guardian: {consultation.patient.guardianName}
              </p>
            )}
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-[#5C6B72]">
              <MapPin size={13} strokeWidth={1.75} />{" "}
              {consultation.patient.location}
            </p>
          </div>
        </div>

        {consultation.rescheduleHistory.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setExpandedHistory((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-[#5C6B72] hover:text-[#12242C]"
            >
              <History size={12} strokeWidth={2} />
              Rescheduled {consultation.rescheduleHistory.length}{" "}
              {consultation.rescheduleHistory.length === 1 ? "time" : "times"}
            </button>
            {expandedHistory && (
              <ul className="mt-1.5 space-y-1 border-l border-[#DCE6EC] pl-3 text-xs text-[#5C6B72]">
                {consultation.rescheduleHistory.map((entry, idx) => (
                  <li key={idx}>
                    Moved from {formatDateTime(entry.from)} to{" "}
                    {formatDateTime(entry.to)} — {entry.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {isOnline ? (
            unlocked ? (
              <button
                type="button"
                onClick={handleStart}
                disabled={starting || !inRoom}
                title={inRoom ? undefined : "Available on the telemedicine room computer"}
                className="flex items-center gap-2 rounded-sm px-3.5 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                style={{ backgroundColor: "#0095D9" }}
              >
                {starting ? (
                  <Loader2 size={15} strokeWidth={2} className="animate-spin" />
                ) : (
                  <Video size={15} strokeWidth={2} />
                )}
                {callInProgress
                  ? starting ? "Rejoining…" : "Rejoin call"
                  : starting ? "Starting…" : "Start video call"}
              </button>
            ) : (
              <span className="flex items-center gap-1.5 rounded-sm border border-[#DCE6EC] px-3 py-2 text-sm text-[#5C6B72]">
                <Lock size={14} strokeWidth={1.75} />
                Call opens in {minutesUntilUnlock}m
              </span>
            )
          ) : (
            <span className="flex items-center gap-1.5 rounded-sm border border-[#DCE6EC] px-3 py-2 text-sm text-[#5C6B72]">
              <MapPin size={14} strokeWidth={1.75} /> Patient attends in person
            </span>
          )}

          {/* A video call can be closed as completed only once the two
              were connected; a hospital visit any time. */}
          {(!isOnline || consultation.met) && (
            <button
              type="button"
              onClick={() => onMarkDone(consultation)}
              className="flex items-center gap-2 rounded-sm border border-[#DCE6EC] px-3.5 py-2 text-sm font-medium text-[#12242C] transition hover:border-[#0095D9]"
            >
              <CheckSquare size={15} strokeWidth={1.75} />
              Mark done
            </button>
          )}

          {consultation.met ? (
            <button
              type="button"
              onClick={() => onCantMakeIt(consultation, "call_incomplete")}
              className="flex items-center gap-2 rounded-sm border border-[#DCE6EC] px-3.5 py-2 text-sm font-medium text-[#B23A3A] transition hover:border-[#B23A3A]"
            >
              <CalendarX2 size={15} strokeWidth={1.75} />
              Call couldn&apos;t be completed
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onCantMakeIt(consultation, "doctor_absent")}
              className="flex items-center gap-2 rounded-sm border border-[#DCE6EC] px-3.5 py-2 text-sm font-medium text-[#B23A3A] transition hover:border-[#B23A3A]"
            >
              <CalendarX2 size={15} strokeWidth={1.75} />
              I can&apos;t make it
            </button>
          )}

          {callError && (
            <span className="text-xs" style={{ color: "#D64545" }}>
              {callError}
            </span>
          )}

          {isOnline && unlocked && !inRoom && (
            <span className="text-xs text-[#5C6B72]">
              Start this call from the telemedicine room computer.
            </span>
          )}

          {isOnline && consultation.waitDeadline?.for === "doctor" && (
            <span className="text-xs font-semibold text-[#B23A3A]">
              The patient is waiting in the call. Join before{" "}
              {formatTime(consultation.waitDeadline.at)}, or it counts as an appointment you
              couldn&apos;t make.
            </span>
          )}

          {isOnline && consultation.waitDeadline?.for === "patient" && (
            <span className="text-xs text-[#5C6B72]">
              Waiting for the patient until {formatTime(consultation.waitDeadline.at)}.
            </span>
          )}

          {!isOnline && (
            <span className="text-xs" style={{ color: "#F88535" }}>
              Admin can also mark this one, with confirmation
            </span>
          )}
        </div>
      </div>

      <div className="w-full shrink-0 self-stretch border-t border-[#DCE6EC] md:w-64 md:border-l md:border-t-0">
        <div className="flex h-full flex-col justify-between">
          <SensitiveDetails details={consultation.sensitiveDetails} />
          {callInProgress && (
            <p className="flex items-center gap-1.5 border-t border-[#DCE6EC] px-5 py-2.5 text-xs text-[#5C6B72]">
              <PhoneCall
                size={12}
                strokeWidth={2}
                style={{ color: "#F88535" }}
              />
              Started {formatTime(consultation.callStartedAt)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
