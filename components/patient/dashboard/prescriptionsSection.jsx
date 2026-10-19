import { useEffect, useState } from "react";
import { FileText, Download, Loader2, Ban } from "lucide-react";
import { callableMessage, formatDate, formatDateTime } from "../../../src/constants";
import { fetchMyPrescriptions } from "./patientFirestoreService";
import { downloadPrescription, medicineLabel, PRESCRIPTION_VALID_DAYS } from "../../shared/prescriptions";

// "Your prescriptions" on the patient's appointments tab: what a doctor
// wrote after a video consultation, as the hospital's signed form (PDF).
// Each one can be downloaded for 7 days, then it's deleted. Shown only
// when there is one.
export default function PrescriptionsSection({ patientUid, reloadKey = 0 }) {
  const [list, setList] = useState([]);
  const [downloading, setDownloading] = useState(null);
  const [error, setError] = useState(null); // { id, text }

  useEffect(() => {
    if (!patientUid) return undefined;
    let active = true;
    fetchMyPrescriptions(patientUid)
      .then((data) => active && setList(data))
      .catch(() => {}); // the appointments list shows connection problems
    return () => {
      active = false;
    };
  }, [patientUid, reloadKey]);

  if (list.length === 0) return null;

  async function download(rx) {
    setDownloading(rx.id);
    setError(null);
    try {
      await downloadPrescription(rx.id);
    } catch (err) {
      setError({ id: rx.id, text: callableMessage(err, "We couldn't download it. Please try again.") });
    } finally {
      setDownloading(null);
    }
  }

  return (
    <section aria-labelledby="my-prescriptions">
      <h2 id="my-prescriptions" className="flex items-center gap-2.5 text-xl font-semibold text-[#12242C]">
        <FileText size={22} strokeWidth={1.75} className="text-[#0095D9]" />
        Your prescriptions
      </h2>
      <p className="mt-1 text-base text-black/70">
        Download your prescription and take it to any pharmacy. You can download it for{" "}
        {PRESCRIPTION_VALID_DAYS} days after your doctor writes it.
      </p>
      <div className="mt-4 space-y-3">
        {list.map((rx) => {
          const cancelled = rx.status === "cancelled";
          return (
            <div
              key={rx.id}
              className={`rounded-xl border px-4 py-4 ${
                cancelled ? "border-[#B23A3A]/30 bg-[#B23A3A]/5" : "border-[#0095D9]/30 bg-white"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-[#12242C]">From {rx.doctorName}</p>
                  {rx.guardianName && rx.patientName && (
                    <p className="text-base text-black/70">For {rx.patientName}</p>
                  )}
                  <p className="text-base text-black/70">
                    Written {formatDateTime(rx.issuedAt)}
                    {!cancelled && <> · Download by {formatDate(rx.expiresAt)}</>}
                  </p>
                  <ul className="mt-2 space-y-0.5 text-base text-[#12242C]">
                    {rx.items.map((it, i) => (
                      <li key={i}>
                        <span className="font-medium">{medicineLabel(it)}</span>: {it.dose}, {it.frequency}, for{" "}
                        {it.duration}
                      </li>
                    ))}
                  </ul>
                  {rx.notes && <p className="mt-1 text-base text-black/70">{rx.notes}</p>}
                  <p className="mt-1 text-sm text-black/70">Reference: {rx.id}</p>
                </div>
                {!cancelled && (
                  <button
                    type="button"
                    onClick={() => download(rx)}
                    disabled={downloading === rx.id}
                    className="inline-flex items-center gap-2 rounded-lg px-5 py-3 text-base font-semibold text-white disabled:opacity-70"
                    style={{ backgroundColor: "#0095D9" }}
                  >
                    {downloading === rx.id ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <Download size={18} strokeWidth={2} />
                    )}
                    {downloading === rx.id ? "Getting it…" : "Download PDF"}
                  </button>
                )}
              </div>
              {cancelled && (
                <p className="mt-3 flex items-start gap-2 text-base text-[#8A2626]">
                  <Ban size={18} className="mt-0.5 shrink-0" />
                  <span>
                    Your doctor cancelled this prescription
                    {rx.cancelledAt ? ` on ${formatDate(rx.cancelledAt)}` : ""}. Don&apos;t use it.
                    {rx.cancelReason ? ` Reason: ${rx.cancelReason}` : ""}
                  </span>
                </p>
              )}
              {error?.id === rx.id && (
                <p role="alert" className="mt-2 text-base text-[#B23A3A]">
                  {error.text}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
