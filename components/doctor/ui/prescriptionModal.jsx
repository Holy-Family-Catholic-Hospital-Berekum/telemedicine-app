import { useState } from "react";
import { X, Plus, Trash2, Loader2, ShieldAlert, FileText } from "lucide-react";
import { callableMessage } from "../../../src/constants";
import { medicineLabel, PRESCRIPTION_VALID_DAYS } from "../../shared/prescriptions";

// The doctor writes the prescription for a video consultation
// (functions/prescriptions.js issuePrescription). The server prints it on
// the hospital's form with the doctor's signature and MDC number; the
// patient downloads it for 7 days. It can't be edited afterwards, only
// cancelled, so the second step shows it back for checking.

const MAX_ITEMS = 10;
const EMPTY = { medicine: "", strength: "", form: "", dose: "", frequency: "", duration: "", quantity: "" };
const REQUIRED = ["medicine", "dose", "frequency", "duration"];

const input =
  "mt-1 w-full rounded-md border border-[#C9D6DE] px-2.5 py-2 text-sm text-[#12242C] focus:border-[#0095D9] focus:outline-none focus:ring-2 focus:ring-[#0095D9]/20";
const label = "block text-xs font-medium text-[#5C6B72]";

const FIELDS = [
  { key: "medicine", label: "Medicine *", placeholder: "e.g. Amoxicillin", max: 100, span: "sm:col-span-2" },
  { key: "strength", label: "Strength", placeholder: "e.g. 500 mg", max: 40 },
  { key: "form", label: "Form", placeholder: "e.g. capsule", max: 40 },
  { key: "dose", label: "Dose *", placeholder: "e.g. 1 capsule", max: 60 },
  { key: "frequency", label: "How often *", placeholder: "e.g. three times a day", max: 60 },
  { key: "duration", label: "How long *", placeholder: "e.g. 7 days", max: 40 },
  { key: "quantity", label: "Quantity", placeholder: "e.g. 21", max: 40 },
];

function ageLabel(age) {
  if (!age || !Number.isInteger(age.years)) return null;
  if (age.years >= 2) return `${age.years} years`;
  return `${age.years ? `${age.years} year ` : ""}${age.months ?? 0} months`;
}

// inCall: opened from the video call screen. A panel on the right over the
// call (no dark backdrop), so the doctor still sees and hears the patient.
export default function PrescriptionModal({ consultation, onClose, onIssue, inCall = false }) {
  const [items, setItems] = useState([{ ...EMPTY }]);
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState("write"); // "write" | "confirm"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const complete = items.every((it) => REQUIRED.every((k) => it[k].trim()));
  const age = ageLabel(consultation.sensitiveDetails?.age);
  const sex = consultation.sensitiveDetails?.sex;

  function setField(i, key, value) {
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, [key]: value } : it)));
  }

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      await onIssue({
        consultation,
        items: items.map((it) => Object.fromEntries(Object.entries(it).map(([k, v]) => [k, v.trim()]))),
        notes: notes.trim(),
      });
    } catch (err) {
      setError(callableMessage(err, "Couldn't issue the prescription. Please try again."));
      setBusy(false);
    }
  }

  return (
    <div
      className={
        inCall
          ? "pointer-events-none fixed inset-0 z-[60] flex justify-end"
          : "fixed inset-0 z-50 flex items-center justify-center bg-[#0B1A1C]/50 p-4"
      }
    >
      <div
        className={
          inCall
            ? "pointer-events-auto flex h-[100dvh] w-full max-w-xl flex-col bg-white shadow-2xl"
            : "flex max-h-[92vh] w-full max-w-2xl flex-col rounded-md bg-white shadow-xl"
        }
      >
        <div className="flex items-center justify-between border-b border-[#DCE6EC] px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-[#12242C]">
              <FileText size={17} strokeWidth={1.75} className="text-[#0095D9]" />
              {step === "write" ? "Write prescription" : "Check and issue"}
            </h2>
            <p className="text-xs text-[#5C6B72]">
              {consultation.patient.name}
              {consultation.patient.guardianName ? ` (parent/guardian: ${consultation.patient.guardianName})` : ""}
              {age ? ` · ${age}` : ""}
              {sex ? ` · ${sex[0].toUpperCase()}${sex.slice(1)}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="text-[#5C6B72] hover:text-[#12242C]">
            <X size={18} />
          </button>
        </div>

        {step === "write" ? (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              if (complete) setStep("confirm");
            }}
          >
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {items.map((it, i) => (
                <fieldset key={i} className="rounded-md border border-[#DCE6EC] p-3.5">
                  <legend className="flex items-center gap-2 px-1 text-sm font-medium text-[#12242C]">
                    Medicine {i + 1}
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
                        className="flex items-center gap-1 text-xs font-normal text-[#B23A3A] hover:underline"
                      >
                        <Trash2 size={12} /> Remove
                      </button>
                    )}
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-4">
                    {FIELDS.map((f) => (
                      <div key={f.key} className={f.span || ""}>
                        <label htmlFor={`rx-${i}-${f.key}`} className={label}>
                          {f.label}
                        </label>
                        <input
                          id={`rx-${i}-${f.key}`}
                          type="text"
                          maxLength={f.max}
                          required={REQUIRED.includes(f.key)}
                          value={it[f.key]}
                          onChange={(e) => setField(i, f.key, e.target.value)}
                          placeholder={f.placeholder}
                          className={input}
                        />
                      </div>
                    ))}
                  </div>
                </fieldset>
              ))}
              {items.length < MAX_ITEMS && (
                <button
                  type="button"
                  onClick={() => setItems((prev) => [...prev, { ...EMPTY }])}
                  className="flex items-center gap-1.5 text-sm font-medium text-[#0095D9] hover:underline"
                >
                  <Plus size={15} /> Add another medicine
                </button>
              )}
              <div>
                <label htmlFor="rx-notes" className={label}>
                  Notes for the patient and pharmacist (optional)
                </label>
                <textarea
                  id="rx-notes"
                  rows={2}
                  maxLength={500}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Take after meals."
                  className={input}
                />
              </div>
            </div>
            <div className="flex gap-3 border-t border-[#DCE6EC] px-5 py-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-sm border border-[#DCE6EC] py-2.5 text-sm font-medium text-[#12242C] transition hover:border-[#0095D9]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!complete}
                className="flex-1 rounded-sm py-2.5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: "#0095D9" }}
              >
                Continue
              </button>
            </div>
          </form>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <ol className="space-y-2.5">
                {items.map((it, i) => (
                  <li key={i} className="rounded-md border border-[#DCE6EC] px-3.5 py-2.5 text-sm">
                    <p className="font-medium text-[#12242C]">
                      {i + 1}. {medicineLabel(it)}
                    </p>
                    <p className="text-[#5C6B72]">
                      {it.dose}, {it.frequency}, for {it.duration}
                      {it.quantity ? ` · Quantity: ${it.quantity}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
              {notes.trim() && (
                <p className="mt-3 text-sm text-[#12242C]">
                  <span className="font-medium">Notes:</span> {notes.trim()}
                </p>
              )}
              <div className="mt-4 flex gap-3 rounded-md border border-[#DCE6EC] bg-[#F5F8FA] p-3.5">
                <ShieldAlert size={20} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: "#F88535" }} />
                <p className="text-sm text-[#12242C]">
                  This is signed with your signature and MDC number. The patient can download it for{" "}
                  {PRESCRIPTION_VALID_DAYS} days. It can&apos;t be changed afterwards and you can&apos;t write
                  another one for this consultation; you can only cancel it. Also record it in LHIMS as usual.
                </p>
              </div>
              {error && (
                <p role="alert" className="mt-3 text-sm text-[#B23A3A]">
                  {error}
                </p>
              )}
            </div>
            <div className="flex gap-3 border-t border-[#DCE6EC] px-5 py-4">
              <button
                type="button"
                onClick={() => setStep("write")}
                disabled={busy}
                className="flex-1 rounded-sm border border-[#DCE6EC] py-2.5 text-sm font-medium text-[#12242C] transition hover:border-[#0095D9] disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={issue}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-2 rounded-sm py-2.5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-70"
                style={{ backgroundColor: "#0095D9" }}
              >
                {busy && <Loader2 size={15} strokeWidth={2} className="animate-spin" />}
                {busy ? "Issuing…" : "Sign and issue"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
