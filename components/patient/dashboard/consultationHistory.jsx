function formatDate(iso) {
  if (!iso) return "Unknown date";

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return date.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(iso) {
  if (!iso) return "Unknown time";

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ConsultationHistory({ consultations = [] }) {
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
                {formatDate(consultation.startTime)}
              </p>
            </div>

            <span className="text-xs text-black/45 shrink-0">Completed</span>
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-black/60">
              <span>
                {formatTime(consultation.startTime)}
                {" – "}
                {formatTime(consultation.endTime)}
              </span>

              <span className="text-black/25">·</span>

              <span>
                {consultation.mode === "online" ? "Online" : "In person"}
              </span>
            </div>

            {consultation.amountPaid != null && (
              <span className="text-[11px] text-black/30 shrink-0">
                GHS {Number(consultation.amountPaid).toFixed(2)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
