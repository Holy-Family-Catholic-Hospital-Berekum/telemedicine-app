import {
  MODE_LABELS,
  OUTCOME_LABELS,
  formatDate,
  formatTime,
} from "../../../src/constants";
import RefundRequest from "./refundRequest";
import { Pagination, LoadOlder } from "../../shared/pagination.jsx";
import { usePagination } from "../../shared/usePagination.js";

// Closed consultations. Shows only what's kept after a consultation
// closes: doctor, date, start and end time, mode, outcome and amount paid.
export default function ConsultationHistory({
  consultations = [],
  refunds = {},
  defaultPhone,
  onRefundRequested,
  canLoadMore = false,
  loadingMore = false,
  onLoadMore,
}) {
  const pager = usePagination(consultations, 10);
  if (!consultations.length) {
    return <p className="text-sm text-black/75">No past consultations yet.</p>;
  }

  return (
    <div>
    <div className="space-y-2.5">
      {pager.pageItems.map((consultation) => (
        <div
          key={consultation.id}
          className="rounded-md border border-black/10 bg-white px-4 py-3.5"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-black truncate">
                {consultation.doctorName || "Doctor"}
              </p>

              <p className="mt-0.5 text-xs text-black/75">
                {formatDate(consultation.startedAt)}
              </p>
            </div>

            <span className="text-xs text-black/70 shrink-0">
              {OUTCOME_LABELS[consultation.outcome] ?? "Closed"}
            </span>
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-black/75">
              <span>
                {formatTime(consultation.startedAt)}
                {" – "}
                {formatTime(consultation.endedAt)}
              </span>

              <span className="text-black/75">·</span>

              <span>{MODE_LABELS[consultation.mode] ?? consultation.mode}</span>
            </div>

            {consultation.amountPaid != null && (
              <span className="text-xs text-black/75 shrink-0">
                {consultation.currency}{" "}
                {Number(consultation.amountPaid).toFixed(2)}
              </span>
            )}
          </div>
          {/* Refunds only for a consultation the patient didn't attend. */}
          {(refunds[consultation.id] ||
            (consultation.outcome === "no_show" &&
              !consultation.patientJoined &&
              !consultation.refundClosed)) && (
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
    <Pagination {...pager} noun="consultations" size="lg" />
    <LoadOlder
      canLoadMore={canLoadMore}
      loading={loadingMore}
      onLoadMore={onLoadMore}
      loaded={consultations.length}
      noun="consultations"
      size="lg"
    />
    </div>
  );
}
