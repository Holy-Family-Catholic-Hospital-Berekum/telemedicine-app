import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, Search } from "lucide-react";
import { functions } from "../firebase";
import { tracked } from "../networkStatus";
import { usePageMeta } from "../seo.js";
import { formatDate, formatDateTime } from "../constants";
import logo from "../assets/logo.webp";
import { medicineLabel, PRESCRIPTION_VALID_DAYS } from "../../components/shared/prescriptions";

/**
 * checkPrescription.jsx, at "/check-prescription".
 * Where the QR code on a prescription form leads: a pharmacist (no sign-in)
 * sees whether it's valid, expired or cancelled, the doctor and MDC number,
 * the dates and the medicines, to match against the paper. Never the
 * patient's name. The code is in the URL #fragment (never sent to a
 * server log) or typed in. functions/prescriptions.js checkPrescription.
 */

const callCheck = tracked(httpsCallable(functions, "checkPrescription"));

const STATUS = {
  valid: {
    icon: CheckCircle2,
    color: "#16683F",
    bg: "#1E8E5A",
    title: "Valid prescription",
    text: "Issued by Holy Family Catholic Hospital. Check the medicines below match the paper.",
  },
  expired: {
    icon: AlertTriangle,
    color: "#A85420",
    bg: "#F88535",
    title: "Expired",
    text: `This prescription was valid for ${PRESCRIPTION_VALID_DAYS} days and has expired. Don't dispense it.`,
  },
  cancelled: {
    icon: XCircle,
    color: "#8A2626",
    bg: "#B23A3A",
    title: "Cancelled by the doctor",
    text: "Don't dispense this prescription. The patient should contact the hospital.",
  },
  not_found: {
    icon: XCircle,
    color: "#8A2626",
    bg: "#B23A3A",
    title: "No valid prescription with this code",
    text: `Check the code was typed correctly. Prescriptions are removed ${PRESCRIPTION_VALID_DAYS} days after they're written, so an older one can't be checked here. If in doubt, call the hospital.`,
  },
};

function normalise(value) {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

function codeFromHash() {
  return decodeURIComponent(window.location.hash.replace(/^#/, "")).trim();
}

export default function CheckPrescription() {
  usePageMeta({ title: "Check a prescription", noindex: true });
  const [code, setCode] = useState(codeFromHash);
  // The code being checked (opened from the QR code: straight away).
  const [checking, setChecking] = useState(() => normalise(codeFromHash()) || null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const busy = Boolean(checking);

  useEffect(() => {
    if (!checking) return undefined;
    let active = true;
    callCheck({ code: checking })
      .then(({ data }) => active && setResult(data))
      .catch((err) => {
        if (!active) return;
        setError(
          err?.code === "functions/resource-exhausted"
            ? "Too many checks from this connection. Please wait a while and try again."
            : "We couldn't check right now. Check your internet connection and try again.",
        );
      })
      .finally(() => active && setChecking(null));
    return () => {
      active = false;
    };
  }, [checking]);

  function check(value) {
    const c = normalise(value);
    if (!c) return;
    setError(null);
    setResult(null);
    setChecking(c);
  }

  const s = result ? STATUS[result.status] || STATUS.not_found : null;

  return (
    <main className="min-h-screen bg-[#F5F8FA] px-4 py-8 text-[#12242C]">
      <div className="mx-auto max-w-xl">
        <div className="flex items-center gap-3">
          <img src={logo} alt="" className="h-12 w-12 shrink-0" />
          <div>
            <p className="text-lg font-semibold leading-tight">Holy Family Catholic Hospital, Berekum</p>
            <p className="text-base text-black/70">Prescription check</p>
          </div>
        </div>

        <form
          className="mt-6 rounded-xl border border-[#DCE6EC] bg-white p-5"
          onSubmit={(e) => {
            e.preventDefault();
            window.history.replaceState(null, "", `#${normalise(code)}`);
            check(code);
          }}
        >
          <label htmlFor="rx-code" className="block text-base font-medium">
            Code on the prescription
          </label>
          <p className="text-sm text-black/70">Scan the QR code, or type the code printed under it.</p>
          <div className="mt-2 flex gap-2">
            <input
              id="rx-code"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={30}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
              className="min-w-0 flex-1 rounded-md border border-[#C9D6DE] px-3 py-2.5 font-mono text-base uppercase tracking-wider focus:border-[#0095D9] focus:outline-none focus:ring-2 focus:ring-[#0095D9]/20"
            />
            <button
              type="submit"
              disabled={busy || !code.trim()}
              className="inline-flex shrink-0 items-center gap-2 rounded-md bg-[#0095D9] px-4 py-2.5 text-base font-semibold text-white disabled:opacity-60"
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
              Check
            </button>
          </div>
        </form>

        {error && (
          <p role="alert" className="mt-4 rounded-md bg-[#B23A3A]/10 px-4 py-3 text-base text-[#8A2626]">
            {error}
          </p>
        )}

        {s && (
          <section className="mt-5 overflow-hidden rounded-xl border border-[#DCE6EC] bg-white" aria-live="polite">
            <div className="flex items-start gap-3 px-5 py-4" style={{ backgroundColor: `${s.bg}14` }}>
              <s.icon size={28} strokeWidth={2} className="mt-0.5 shrink-0" style={{ color: s.color }} />
              <div>
                <h1 className="text-xl font-semibold" style={{ color: s.color }}>
                  {s.title}
                </h1>
                <p className="mt-0.5 text-base text-[#3E4E56]">{s.text}</p>
              </div>
            </div>
            {result.status !== "not_found" && (
              <div className="space-y-4 px-5 py-5 text-base">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm text-black/70">Reference</dt>
                    <dd className="font-medium">{result.reference}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-black/70">Written</dt>
                    <dd className="font-medium">{formatDateTime(new Date(result.issuedAt))}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-black/70">Doctor</dt>
                    <dd className="font-medium">
                      {result.doctorName}
                      {result.doctorDepartment ? `, ${result.doctorDepartment}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-black/70">MDC registration number</dt>
                    <dd className="font-medium">{result.doctorMdcNumber}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-black/70">
                      {result.status === "cancelled" ? "Cancelled" : "Valid until"}
                    </dt>
                    <dd className="font-medium">
                      {result.status === "cancelled" && result.cancelledAt
                        ? formatDateTime(new Date(result.cancelledAt))
                        : formatDate(new Date(result.expiresAt))}
                    </dd>
                  </div>
                </dl>
                <div>
                  <h2 className="text-sm text-black/70">Medicines</h2>
                  <ol className="mt-1 space-y-2">
                    {(result.items || []).map((it, i) => (
                      <li key={i} className="rounded-md border border-[#DCE6EC] px-3 py-2">
                        <p className="font-medium">
                          {i + 1}. {medicineLabel(it)}
                        </p>
                        <p className="text-black/70">
                          {it.dose}, {it.frequency}, for {it.duration}
                          {it.quantity ? ` · Quantity: ${it.quantity}` : ""}
                        </p>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
