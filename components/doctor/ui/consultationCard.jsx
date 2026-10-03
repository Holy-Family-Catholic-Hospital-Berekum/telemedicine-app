import { useState } from "react";
import {
  Video,
  MapPin,
  Lock,
  PhoneCall,
  CheckSquare,
  History,
} from "lucide-react";
import SensitiveDetails from "../sensitiveDetails";
import { getCallWindow } from "../docUtils";
import VerifyConsultationIdModal from "./verifyConsultationIdModal";
import { TYPE_LABELS, formatTime } from "../../../src/constants";

const MODE_STYLE = {
  online: { spine: "#0095D9", chipText: "#0095D9", label: "Online" },
  in_person: { spine: "#F88535", chipText: "#F88535", label: "In person" },
};

export default function ConsultationCard({
  consultation,
  onStartCall,
  onMarkDone,
}) {
  const [expandedHistory, setExpandedHistory] = useState(false);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const mode = MODE_STYLE[consultation.mode] ?? MODE_STYLE.in_person;
  const isOnline = consultation.mode === "online";
  const callInProgress = isOnline && consultation.status === "in_progress";
  const { unlocked, minutesUntilUnlock } = getCallWindow(
    consultation.scheduledTime,
  );

  const [rejoinError, setRejoinError] = useState(null);
  const [rejoining, setRejoining] = useState(false);

  // Doctors get the consultation ID from reception and type it in to START
  // a call (startVideoCall checks it, with the assignment and time window).
  // Once the call has started, rejoining doesn't ask again. This is an
  // organisational control, not the security boundary: rules and the
  // function are.
  async function handleRejoin() {
    setRejoining(true);
    setRejoinError(null);
    const result = await onStartCall(consultation.consultationId, consultation.consultationId);
    setRejoining(false);
    if (!result.ok) setRejoinError(result.message);
  }

  async function handleVerifyId(enteredId) {
    const result = await onStartCall(consultation.consultationId, enteredId);
    if (result.ok) setVerifyModalOpen(false);
    return result;
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
                {formatTime(consultation.scheduledTime)}
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
                    Moved from {formatTime(entry.from)} to{" "}
                    {formatTime(entry.to)} — {entry.reason}
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
                onClick={() => (callInProgress ? handleRejoin() : setVerifyModalOpen(true))}
                disabled={rejoining}
                className="flex items-center gap-2 rounded-sm px-3.5 py-2 text-sm font-medium text-white transition disabled:opacity-60"
                style={{ backgroundColor: "#0095D9" }}
              >
                <Video size={15} strokeWidth={2} />
                {callInProgress ? (rejoining ? "Rejoining…" : "Rejoin call") : "Start video call"}
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

          <button
            type="button"
            onClick={() => onMarkDone(consultation)}
            className="flex items-center gap-2 rounded-sm border border-[#DCE6EC] px-3.5 py-2 text-sm font-medium text-[#12242C] transition hover:border-[#0095D9]"
          >
            <CheckSquare size={15} strokeWidth={1.75} />
            Mark done
          </button>

          {rejoinError && (
            <span className="text-xs" style={{ color: "#D64545" }}>
              {rejoinError}
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

      {verifyModalOpen && (
        <VerifyConsultationIdModal
          onClose={() => setVerifyModalOpen(false)}
          onVerify={handleVerifyId}
        />
      )}
    </div>
  );
}
