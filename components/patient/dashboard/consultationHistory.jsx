import {
  MODE_LABELS,
  OUTCOME_LABELS,
  formatDate,
  formatTime,
} from "../../../src/constants";
import RefundRequest from "./refundRequest";

// Closed consultations. Shows only what's kept after a consultation
// closes: doctor, date, start and end time, mode, outcome and amount paid.
export default function ConsultationHistory({ consultations = [], refunds = {}, defaultPhone, onRefundRequested }) {
  if (!consultations.length) {
    return <p className="text-sm text-black/60">No past consultations yet.</p>;
  }

  return (
    <div className="space-y-2.5">
      {consultations.map((consultation) => (
        <div
          key={consultation.id}
          className="rounded-md border border-black/10 bg-white px-4 py-3.5"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-black truncate">
                {consultation.doctorName || "Doctor"}
              </p>

              <p className="mt-0.5 text-xs text-black/60">
                {formatDate(consultation.startedAt)}
              </p>
            </div>

            <span className="text-xs text-black/45 shrink-0">
              {OUTCOME_LABELS[consultation.outcome] ?? "Closed"}
            </span>
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-black/60">
              <span>
                {formatTime(consultation.startedAt)}
                {" – "}
                {formatTime(consultation.endedAt)}
              </span>

              <span className="text-black/25">·</span>

              <span>{MODE_LABELS[consultation.mode] ?? consultation.mode}</span>
            </div>

            {consultation.amountPaid != null && (
              <span className="text-xs text-black/60 shrink-0">
                {consultation.currency}{" "}
                {Number(consultation.amountPaid).toFixed(2)}
              </span>
            )}
          </div>
          {/* Refunds only for a consultation the patient didn't attend. */}
          {(refunds[consultation.id] ||
            (consultation.outcome === "no_show" && !consultation.patientJoined)) && (
            <div className="mt-2">
              <RefundRequest
                source="history"
                id={consultation.id}
                scheduledTime={consultation.scheduledTime || consultation.startedAt}
                amountPaid={consultation.amountPaid}
                existing={refunds[consultation.id]}
                defaultPhone={defaultPhone}
                onRequested={onRefundRequested}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
