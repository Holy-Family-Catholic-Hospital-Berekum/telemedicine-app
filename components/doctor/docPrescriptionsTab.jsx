import { useCallback, useEffect, useState } from "react";
import { FileText, Download, Ban, Loader2, X } from "lucide-react";
import { callableMessage, formatDate, formatDateTime } from "../../src/constants";
import { fetchMyPrescriptions, cancelPrescription } from "./docFirestoreService";
import { downloadPrescription, medicineLabel, PRESCRIPTION_VALID_DAYS } from "../shared/prescriptions";
import { Pagination } from "../shared/pagination.jsx";
import { usePagination } from "../shared/usePagination.js";

// The prescriptions this doctor wrote in the last 7 days (after that
// they're deleted). The doctor can download the form or cancel one: a
// cancelled prescription shows as cancelled to the patient and on the
// pharmacist's check page, and can't be replaced.

function CancelDialog({ rx, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await cancelPrescription({ prescriptionId: rx.id, reason: reason.trim() });
      onDone();
    } catch (err) {
      setError(callableMessage(err, "Couldn't cancel it. Please try again."));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1A1C]/50 p-4">
      <div className="w-full max-w-md rounded-md bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#DCE6EC] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#12242C]">Cancel prescription</h2>
            <p className="text-xs text-[#5C6B72]">
              {rx.id} · {rx.patientName}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="text-[#5C6B72] hover:text-[#12242C]">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-5">
          <p className="text-sm text-[#12242C]">
            The pharmacist&apos;s check will show it as cancelled, and the patient can no longer download it.
            You can&apos;t write another prescription for this consultation.
          </p>
          <label htmlFor="rx-cancel-reason" className="mt-4 block text-sm font-medium text-[#12242C]">
            Reason, shown to the patient (optional)
          </label>
          <textarea
            id="rx-cancel-reason"
            rows={2}
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Wrong dose. Please call the hospital."
            className="mt-1.5 w-full rounded-md border border-[#C9D6DE] px-3 py-2 text-sm text-[#12242C] focus:border-[#0095D9] focus:outline-none"
          />
          {error && (
            <p role="alert" className="mt-3 text-sm text-[#B23A3A]">
              {error}
            </p>
          )}
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 rounded-sm border border-[#DCE6EC] py-2.5 text-sm font-medium text-[#12242C] transition hover:border-[#0095D9] disabled:opacity-50"
            >
              Keep it
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-sm bg-[#B23A3A] py-2.5 text-sm font-medium text-white transition hover:bg-[#96302F] disabled:opacity-70"
            >
              {busy && <Loader2 size={15} className="animate-spin" />}
              Cancel prescription
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PrescriptionsTab({ doctorUid, onToast, reloadKey = 0 }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const pager = usePagination(list ?? [], 10);

  const [loadKey, setLoadKey] = useState(0);
  const load = useCallback(() => setLoadKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    fetchMyPrescriptions(doctorUid)
      .then((data) => {
        if (!active) return;
        setList(data);
        setError(false);
      })
      .catch(() => {
        if (!active) return;
        setList([]);
        setError(true);
      });
    return () => {
      active = false;
    };
  }, [doctorUid, reloadKey, loadKey]);

  async function download(rx) {
    setDownloading(rx.id);
    try {
      await downloadPrescription(rx.id);
    } catch (err) {
      onToast(callableMessage(err, "Couldn't download it. Please try again."), 4000);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <section>
      <h2 className="text-sm font-medium text-[#5C6B72]">Prescriptions you wrote</h2>
      <p className="mt-1 text-sm text-[#5C6B72]">
        Write one during a video call (the &quot;Prescription&quot; button on the call screen) or afterwards from
        the consultation&apos;s card, up to 24 hours after the call and before you mark it done. Patients can download them for {PRESCRIPTION_VALID_DAYS} days,
        then they&apos;re deleted.
      </p>

      <div className="mt-4">
        {list === null ? (
          <div className="rounded-md border border-dashed border-[#DCE6EC] bg-white p-8 text-center text-sm text-[#5C6B72]">
            Loading…
          </div>
        ) : error ? (
          <div className="rounded-md border border-dashed border-[#DCE6EC] bg-white p-8 text-center text-sm text-[#5C6B72]">
            Couldn&apos;t load your prescriptions.{" "}
            <button type="button" onClick={load} className="font-medium text-[#0095D9] hover:underline">
              Try again
            </button>
          </div>
        ) : list.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#DCE6EC] bg-white p-8 text-center text-sm text-[#5C6B72]">
            No prescriptions in the last {PRESCRIPTION_VALID_DAYS} days.
          </div>
        ) : (
          <div className="space-y-3">
            {pager.pageItems.map((rx) => {
              const cancelled = rx.status === "cancelled";
              return (
                <div key={rx.id} className="rounded-md border border-[#DCE6EC] bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-2 text-sm text-[#5C6B72]">
                        <FileText size={14} strokeWidth={1.75} />
                        {rx.id} · {formatDateTime(rx.issuedAt)}
                        <span
                          className="rounded-sm px-1.5 py-0.5 text-xs"
                          style={
                            cancelled
                              ? { backgroundColor: "#B23A3A14", color: "#8A2626" }
                              : { backgroundColor: "#1E8E5A14", color: "#16683F" }
                          }
                        >
                          {cancelled ? "Cancelled" : `Valid until ${formatDate(rx.expiresAt)}`}
                        </span>
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-[#12242C]">{rx.patientName}</h3>
                      {rx.guardianName && (
                        <p className="text-sm text-[#5C6B72]">Child · parent/guardian: {rx.guardianName}</p>
                      )}
                      <ul className="mt-1.5 text-sm text-[#12242C]">
                        {rx.items.map((it, i) => (
                          <li key={i}>
                            {medicineLabel(it)}: {it.dose}, {it.frequency}, {it.duration}
                          </li>
                        ))}
                      </ul>
                    </div>
                    {!cancelled && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => download(rx)}
                          disabled={downloading === rx.id}
                          className="flex items-center gap-2 rounded-sm border border-[#DCE6EC] px-3 py-2 text-sm font-medium text-[#12242C] transition hover:border-[#0095D9] disabled:opacity-60"
                        >
                          {downloading === rx.id ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <Download size={15} strokeWidth={1.75} />
                          )}
                          PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => setCancelTarget(rx)}
                          className="flex items-center gap-2 rounded-sm border border-[#DCE6EC] px-3 py-2 text-sm font-medium text-[#B23A3A] transition hover:border-[#B23A3A]"
                        >
                          <Ban size={15} strokeWidth={1.75} />
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <Pagination {...pager} noun="prescriptions" />
          </div>
        )}
      </div>

      {cancelTarget && (
        <CancelDialog
          rx={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onDone={() => {
            setCancelTarget(null);
            onToast("Prescription cancelled.", 3000);
            load();
          }}
        />
      )}
    </section>
  );
}
