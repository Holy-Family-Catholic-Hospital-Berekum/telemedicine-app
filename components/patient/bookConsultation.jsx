import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getFunctions, httpsCallable } from "firebase/functions";

// ASSUMPTION: your initialised Firebase app. Most projects export it from
// a single src/firebase.js — adjust this path if yours lives elsewhere.
import { app } from "../../src/firebase";

// ASSUMPTION: adjust these two import paths to match your actual shared
// header/footer components — I don't have their real location, so this
// points at the conventional spot. If your project keeps them elsewhere
// (e.g. "../components/layout/Header"), just update these two lines.
import Header from "../shared/header";
import Footer from "../shared/footer";
// Fixed, auto-slideshow brand panel — see BrandAside.jsx.
import BrandAside from "../shared/brandAside";

/**
 * bookConsultation.jsx
 * Patient-facing booking flow, lives at "/book".
 * Assumes the patient is already signed in and email-verified (per the
 * architecture, accounts are created before booking) — wrap this route in
 * whatever auth guard / protected route pattern the rest of the app uses.
 *
 * ── PAYMENT MODEL ────────────────────────────────────────────────────
 * Payment is collected ONLINE through Flutterwave (mobile money), which
 * settles straight into the hospital's MoMo account. There is no manual
 * "send us the money and paste your transaction ID" step any more.
 *
 * The rule the UI enforces: a booking is only ever created/confirmed
 * once OUR SERVER says the payment is confirmed. The client never
 * decides this. Flutterwave's browser-side callback is treated purely as
 * a hint that the charge finished — it is not proof. The server calls
 * Flutterwave's verify endpoint (and/or trusts the webhook) and returns
 * the verdict, and only a "confirmed" verdict advances the patient to
 * the success step. A "pending" verdict parks them on a waiting state
 * with a "Check payment status" retry; a "failed" verdict keeps them on
 * the payment step so they can try again. In no branch does the patient
 * get a booking without a server-confirmed payment.
 *
 * The three calls this page makes — createBookingDraft,
 * initializePayment and getBookingStatus — are Firebase callable
 * functions (see functions/index.js). The secret key and the webhook
 * live there; nothing sensitive is in this file. Checkout is
 * Flutterwave's inline modal, loaded on demand from v3.js.
 *
 * ── ERROR VISIBILITY ─────────────────────────────────────────────────
 * Errors used to render once, at the very top of the page, so a patient
 * who had scrolled down to the submit button saw nothing happen. Now:
 *   1. The error renders directly above the button that triggered it —
 *      i.e. where the patient is already looking.
 *   2. On every new error the banner is scrolled into view and focused,
 *      so it's visible and announced even in edge cases (long forms,
 *      small viewports). See `errorRef` + the effect below. Note the
 *      scroll container is the right-hand column, not the window —
 *      scrollIntoView handles that automatically.
 *   3. It's role="alert" + aria-live="assertive" and focusable
 *      (tabIndex -1), so screen readers announce it immediately.
 * Errors are stored as { message, id }; the id increments on every
 * setError so re-submitting with the same mistake re-triggers the
 * scroll/announce instead of silently doing nothing.
 *
 * ── LAYOUT ───────────────────────────────────────────────────────────
 * BrandAside is `position: fixed` (see that file), so it never scrolls.
 * Header, by contrast, is `sticky top-0` (see header.jsx) and is
 * rendered *inside* this page's own scrollable column — that's what
 * makes "sticky" work: it scrolls with the column until it hits the top,
 * then sticks there, rather than floating over content from outside it.
 * That means only one thing has to line up:
 *   - This page's right-hand column is pushed right by exactly the
 *     aside's width (`lg:ml-[340px] xl:ml-[380px]`), so content never
 *     sits under the fixed aside.
 * No manual header-height offset is needed anywhere else on the page.
 *
 * Uses Header with variant="minimal" — a focused-task header (logo, a
 * "Back to home" link, and Sign out when logged in). Header reads real
 * auth state internally (Firebase's onAuthStateChanged) and handles its
 * own sign-out, so this page doesn't manage that state itself.
 *
 * Placeholder values to update before shipping:
 * - CONSULTATION_FEES amounts
 * - FLUTTERWAVE_PUBLIC_KEY (keep the SECRET key server-side only)
 *
 * Defaults: General OPD + Online are pre-selected on step 0, since
 * that's the most common path through this flow.
 *
 * Identifiers are INTERNAL and are not shown to the patient. The draft
 * still carries a reference (minted server-side, one per payment
 * attempt) because Flutterwave needs a unique tx_ref and our staff need
 * something to reconcile against — but the patient never has to copy,
 * keep or quote a code, because Flutterwave verifies the payment for us. The
 * consultation ID isn't shown here either: it's issued when staff assign
 * a doctor and a time, which happens after this flow ends, so the
 * patient receives it by phone/WhatsApp rather than on this page.
 *
 * Back navigation: step 1 shows a "Back" arrow to step 0. Form values
 * already entered stay in state, so going back and forward doesn't lose
 * anything typed. Back is hidden while a payment is in flight or
 * awaiting confirmation, so a patient can't wander off mid-charge. Step
 * 2 is a completed state, not something to undo.
 *
 * PALETTE: three colors only — brand orange (#F88535), brand blue
 * (#0095D9), white. Body text and hairline borders use plain black at
 * reduced opacity (a neutral, not a fourth brand color). The error
 * banner stays in the orange family rather than introducing red.
 */

const CONSULTATION_FEES = {
  OPD: 50,
  SURGICAL: 100,
};

const CURRENCY = "GHS";

// Your Flutterwave PUBLIC key. This one is meant to be visible in the
// browser — it can only start a payment, never read or move money. Put it
// in .env as VITE_FLW_PUBLIC_KEY. The SECRET key lives only in Cloud
// Functions and must never appear anywhere in this app.
const FLUTTERWAVE_PUBLIC_KEY = import.meta.env.VITE_FLW_PUBLIC_KEY;

// Flutterwave's inline checkout script. Loaded on demand, once.
const FLUTTERWAVE_SCRIPT = "https://checkout.flutterwave.com/v3.js";

// Must match the region your functions are deployed to.
const FUNCTIONS_REGION = "europe-west1";

const STEP_LABELS = ["Consultation", "Payment", "Confirmation"];

/* ===================================================================
   BACKEND CALLS

   Note what is NOT here: no amount is ever sent up to the server, and
   nothing in this file can mark a booking as paid. The server reads the
   fee from its own table and decides, on its own, whether money arrived.
   Everything below either asks the server a question or opens
   Flutterwave's modal.
   =================================================================== */

const fns = getFunctions(app, FUNCTIONS_REGION);
const callCreateBookingDraft = httpsCallable(fns, "createBookingDraft");
const callInitializePayment = httpsCallable(fns, "initializePayment");
const callGetBookingStatus = httpsCallable(fns, "getBookingStatus");

// Creates an unpaid booking draft. The server computes the fee — we only
// send what the patient actually chose.
// Resolves: { bookingId, amount, currency }
async function createBookingDraft({
  type,
  mode,
  dateOfBirth,
  sex,
  location,
  phone,
}) {
  const { data } = await callCreateBookingDraft({
    type,
    mode,
    dateOfBirth,
    sex,
    location,
    phone,
  });
  return data;
}

// Mints a fresh, single-use transaction reference for this booking and
// returns what the modal needs. A new reference per attempt is what makes
// retries after a failed payment safe.
// Resolves: { txRef, amount, currency, customer }
async function initializePayment({ bookingId }) {
  const { data } = await callInitializePayment({ bookingId });
  return data;
}

// Loads checkout.flutterwave.com/v3.js once and caches the promise.
let flutterwaveScriptPromise = null;
function loadFlutterwave() {
  if (window.FlutterwaveCheckout) return Promise.resolve();
  if (flutterwaveScriptPromise) return flutterwaveScriptPromise;

  flutterwaveScriptPromise = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = FLUTTERWAVE_SCRIPT;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      flutterwaveScriptPromise = null;
      reject(new Error("Could not load Flutterwave checkout."));
    };
    document.body.appendChild(el);
  });
  return flutterwaveScriptPromise;
}

/**
 * Opens the inline modal and resolves once it closes.
 *
 * What comes back here is a HINT, nothing more. A determined user can
 * change these values in their own browser, so we hand them to no one and
 * ask the server what really happened instead. The modal closing is our
 * cue to start asking — not evidence of anything.
 *
 * Resolves: { status: "successful" | "cancelled", transactionId? }
 */
async function openFlutterwaveCheckout({ txRef, amount, currency, customer }) {
  await loadFlutterwave();

  return new Promise((resolve) => {
    let outcome = null;

    const modal = window.FlutterwaveCheckout({
      public_key: FLUTTERWAVE_PUBLIC_KEY,
      tx_ref: txRef,
      amount,
      currency,
      // Ghana mobile money. Add ",card" if you later accept cards too.
      payment_options: "mobilemoneyghana",
      customer: {
        name: customer?.name || "",
        email: customer?.email || "",
        phone_number: customer?.phone || "",
      },
      customizations: {
        title: "Holy Family Catholic Hospital",
        description: "Consultation fee",
      },
      callback: (response) => {
        outcome = {
          status: "successful",
          transactionId: response?.transaction_id,
        };
        modal.close();
      },
      onclose: () => {
        resolve(outcome || { status: "cancelled" });
      },
    });
  });
}

// Asks the server where this booking stands. The server re-verifies with
// Flutterwave when it hasn't heard from the webhook yet, so this is a real
// check and not just a database read.
// Resolves: { status: "confirmed" | "pending" | "failed", message? }
async function fetchBookingStatus(bookingId) {
  const { data } = await callGetBookingStatus({ bookingId });
  return data;
}

/**
 * Polls for a verdict after the modal closes.
 *
 * Why polling: MoMo confirmations are asynchronous. The charge can be
 * approved on the patient's handset seconds before Flutterwave finishes
 * settling it and calls our webhook. Rather than making the patient press
 * a button into an empty result, we check every few seconds for about a
 * minute, then hand over to the manual "Check payment status" state.
 */
async function waitForConfirmation(
  bookingId,
  { tries = 20, delayMs = 3000 } = {},
) {
  let last = { status: "pending" };
  for (let i = 0; i < tries; i += 1) {
    try {
      last = await fetchBookingStatus(bookingId);
      if (last.status === "confirmed" || last.status === "failed") return last;
    } catch {
      // Transient network error — keep trying, the payment is unaffected.
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}

/* =================================================================== */

// Back arrow between steps. Only step 1 renders this — step 0 has
// nothing behind it (the header's "Back to home" covers leaving), and
// step 2 is a completed state.
function BackButton({ onClick, children = "Back" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 mb-6 text-[15px] font-medium text-black/60
                 hover:text-[#0095D9] transition-colors
                 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0095D9] rounded"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M12.5 5L7 10l5.5 5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </button>
  );
}

/**
 * The error banner. Rendered *next to the control that failed*, not at
 * the top of the page — that was the whole problem. It takes the ref so
 * the page can scroll it into view and focus it (see the effect in
 * BookConsultation).
 */
function ErrorMessage({ error, innerRef }) {
  if (!error) return null;
  return (
    <div
      ref={innerRef}
      role="alert"
      aria-live="assertive"
      tabIndex={-1}
      className="mb-5 flex items-start gap-3 rounded-xl bg-[#F88535]/10 border border-[#F88535]/40 text-[#A85420] text-[15px] px-4 py-3
                 scroll-mt-24 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F88535]"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className="mt-0.5 shrink-0"
      >
        <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M10 6v5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <circle cx="10" cy="14" r="1" fill="currentColor" />
      </svg>
      <span>{error.message}</span>
    </div>
  );
}

// Small spinner for in-flight payment states.
function Spinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="motion-safe:animate-spin"
    >
      <circle
        cx="10"
        cy="10"
        r="7.5"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="2"
      />
      <path
        d="M17.5 10A7.5 7.5 0 0 0 10 2.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function BookConsultation() {
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  // { message, id } — the id makes repeated identical errors re-announce.
  const [error, setError] = useState(null);
  const errorRef = useRef(null);
  const errorId = useRef(0);

  function showError(message) {
    errorId.current += 1;
    setError({ message, id: errorId.current });
  }
  function clearError() {
    setError(null);
  }

  // Scroll the error into view and focus it whenever a new one appears.
  // This is what stops an error from sitting silently above the fold.
  useEffect(() => {
    if (!error) return;
    const node = errorRef.current;
    if (!node) return;
    node.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "center",
    });
    node.focus({ preventScroll: true });
  }, [error]);

  // Pre-selected: General OPD + Online, the most common path.
  const [type, setType] = useState("OPD"); // "OPD" | "SURGICAL"
  const [mode, setMode] = useState("online"); // "online" | "offline"
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [sex, setSex] = useState("");
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");

  // { bookingId, amount, currency }
  const [booking, setBooking] = useState(null);

  // "idle" | "starting" | "checkout" | "verifying" | "pending" | "confirmed"
  const [paymentState, setPaymentState] = useState("idle");
  const [payment, setPayment] = useState(null); // { txRef, transactionId }

  const fee = booking?.amount ?? CONSULTATION_FEES[type];
  const paying =
    paymentState === "starting" ||
    paymentState === "checkout" ||
    paymentState === "verifying";

  function goToStep(n) {
    clearError();
    setStep(n);
  }

  async function handleContinueFromDetails() {
    if (!type || !mode) {
      showError("Choose a consultation type and a mode to continue.");
      return;
    }
    if (!dateOfBirth) {
      showError("Enter your date of birth to continue.");
      return;
    }
    if (!sex) {
      showError("Select your sex to continue.");
      return;
    }
    if (!location.trim()) {
      showError("Enter your location to continue.");
      return;
    }
    if (!phone.trim()) {
      showError("Enter a phone number (WhatsApp preferred) to continue.");
      return;
    }
    clearError();
    setLoading(true);
    try {
      const result = await createBookingDraft({
        type,
        mode,
        dateOfBirth,
        sex,
        location,
        phone,
      });
      setBooking(result);
      setPaymentState("idle");
      setStep(1);
    } catch (e) {
      showError(
        "We couldn't set up your booking. Check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  /**
   * The whole payment path: mint a reference, open the modal, then wait
   * for the SERVER to say the money arrived. The patient only reaches
   * step 2 on a server-confirmed payment — there is deliberately no
   * branch here that trusts the modal's own result.
   */
  async function handlePay() {
    clearError();
    setPaymentState("starting");
    try {
      const session = await initializePayment({ bookingId: booking.bookingId });

      setPaymentState("checkout");
      const result = await openFlutterwaveCheckout({
        txRef: session.txRef,
        amount: session.amount,
        currency: session.currency,
        customer: session.customer,
      });

      setPayment({
        txRef: session.txRef,
        transactionId: result.transactionId,
      });

      if (result.status === "cancelled") {
        // They closed the modal without paying — but a MoMo prompt can
        // still be sitting on their handset, so check once before
        // declaring nothing happened.
        setPaymentState("verifying");
        const check = await fetchBookingStatus(booking.bookingId);
        if (check.status === "confirmed") {
          setPaymentState("confirmed");
          setStep(2);
          return;
        }
        setPaymentState("idle");
        showError(
          "Payment was cancelled, so your booking isn't confirmed. You can start the payment again below.",
        );
        return;
      }

      setPaymentState("verifying");
      const verdict = await waitForConfirmation(booking.bookingId);

      if (verdict.status === "confirmed") {
        setPaymentState("confirmed");
        setStep(2);
        return;
      }
      if (verdict.status === "pending") {
        setPaymentState("pending");
        return;
      }

      setPaymentState("idle");
      showError(
        verdict.message ||
          "Your payment didn't go through, so no booking was made. Try again below.",
      );
    } catch (e) {
      setPaymentState("idle");
      showError(
        "We couldn't reach the payment service. Your booking isn't confirmed — please try again.",
      );
    }
  }

  /**
   * Re-check a payment the network hasn't settled yet. Same rule: only a
   * server "confirmed" advances the patient.
   */
  async function handleCheckPaymentStatus() {
    clearError();
    setPaymentState("verifying");
    try {
      const verdict = await fetchBookingStatus(booking.bookingId);

      if (verdict.status === "confirmed") {
        setPaymentState("confirmed");
        setStep(2);
        return;
      }
      if (verdict.status === "pending") {
        setPaymentState("pending");
        showError(
          "Your payment still hasn't been confirmed by the network. Give it a moment, then check again.",
        );
        return;
      }
      setPaymentState("idle");
      showError(
        verdict.message ||
          "That payment didn't complete, so no booking was made. You can start it again below.",
      );
    } catch (e) {
      setPaymentState("pending");
      showError("We couldn't check your payment just now. Try again shortly.");
    }
  }

  function resetFlow() {
    setStep(0);
    setType("OPD");
    setMode("online");
    setDateOfBirth("");
    setSex("");
    setLocation("");
    setPhone("");
    setBooking(null);
    setPayment(null);
    setPaymentState("idle");
    clearError();
  }

  const payButtonLabel = {
    idle: `Pay ${CURRENCY} ${fee} with mobile money`,
    starting: "Starting secure payment…",
    checkout: "Waiting for your payment…",
    verifying: "Confirming your payment…",
    pending: "Confirming your payment…",
    confirmed: "Payment confirmed",
  }[paymentState];

  return (
    <div className="font-body text-black bg-white min-h-screen overflow-x-hidden">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap');
        .font-display { font-family: 'Fraunces', serif; }
        .font-body { font-family: 'Inter', sans-serif; }
        @keyframes stepIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <BrandAside
        heading={step === 2 ? "You're all set." : "Booking made simple."}
        body="Pick a consultation type, pay securely by mobile money, and our team confirms your appointment directly with you."
        points={[
          "General OPD or surgical consultation",
          "Pay by MoMo in a few taps, confirmed instantly",
          "Appointment shared by phone or WhatsApp",
        ]}
      />

      {/* Right-hand column: pushed clear of the fixed aside, and the
          scroll container for the sticky header. Needs `h-screen`, not
          `min-h-screen` — see the original note: min-h lets the div grow
          past the viewport so it never scrolls itself, which breaks the
          sticky header. */}
      <div className="lg:ml-[340px] xl:ml-[380px] h-screen flex flex-col overflow-y-auto">
        <Header variant="minimal" cancelHref="/" cancelLabel="Back to home" />

        <div className="flex-1">
          {/* Page header band, carrying the current step name. */}
          <div
            className="text-white"
            style={{
              background: "linear-gradient(100deg, #F88535 0%, #0095D9 100%)",
            }}
          >
            <div className="mx-auto max-w-3xl px-5 sm:px-8 py-6 sm:py-8">
              <p className="text-[12.5px] font-medium uppercase tracking-wide text-white/70">
                Book a consultation
              </p>
              <h1 className="mt-1 font-display text-[24px] sm:text-[28px] font-medium">
                {STEP_LABELS[step]}
              </h1>
            </div>
          </div>

          <main className="mx-auto max-w-3xl px-5 sm:px-8 py-8 sm:py-12 w-full">
            {/* ---------- Step indicator ---------- */}
            <ol className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-12">
              {STEP_LABELS.map((label, i) => (
                <li
                  key={label}
                  className="flex items-center flex-1 last:flex-none"
                >
                  <div className="flex items-center gap-2 sm:gap-2.5">
                    <span
                      className={
                        "flex items-center justify-center h-7 w-7 sm:h-8 sm:w-8 rounded-full text-[14px] font-medium shrink-0 " +
                        (i < step
                          ? "bg-[#0095D9] text-white"
                          : i === step
                            ? "bg-[#F88535] text-white"
                            : "bg-black/10 text-black/60")
                      }
                    >
                      {i < step ? (
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 20 20"
                          fill="none"
                        >
                          <path
                            d="M4 10l4 4l8-8"
                            stroke="white"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : (
                        i + 1
                      )}
                    </span>
                    <span
                      className={
                        "hidden sm:inline text-[14px] " +
                        (i === step
                          ? "text-black font-medium"
                          : "text-black/60")
                      }
                    >
                      {label}
                    </span>
                  </div>
                  {i < STEP_LABELS.length - 1 && (
                    <span className="flex-1 h-px bg-black/10 mx-2 sm:mx-3" />
                  )}
                </li>
              ))}
            </ol>
            {/* Mobile equivalent of the desktop step labels. */}
            <p className="sm:hidden mb-9 text-[14px] text-black/60">
              Step {step + 1} of {STEP_LABELS.length} — {STEP_LABELS[step]}
            </p>

            <div
              key={step}
              className="motion-safe:[animation:stepIn_0.35s_ease-out_both]"
            >
              {/* ---------- Step 0: consultation details ---------- */}
              {step === 0 && (
                <section>
                  <h2 className="font-display text-[22px] sm:text-[24px] font-medium">
                    What kind of consultation do you need?
                  </h2>
                  <p className="mt-2 text-[16px] text-black/80">
                    You'll pay on the next step, and choose a doctor and time
                    once your payment is confirmed.
                  </p>

                  <fieldset className="mt-8">
                    <legend className="text-[15px] font-medium mb-3">
                      Consultation type
                    </legend>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {[
                        {
                          key: "OPD",
                          title: "General OPD",
                          desc: "Everyday health concerns and check-ups.",
                        },
                        {
                          key: "SURGICAL",
                          title: "Surgical",
                          desc: "Pre- or post-surgery consultations.",
                        },
                      ].map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setType(opt.key)}
                          aria-pressed={type === opt.key}
                          className={
                            "text-left rounded-2xl p-5 border-2 transition-colors " +
                            (type === opt.key
                              ? "border-[#F88535] bg-[#F88535]/10"
                              : "border-black/10 hover:border-black/30")
                          }
                        >
                          <span className="block font-medium text-[16px]">
                            {opt.title}
                          </span>
                          <span className="block mt-1 text-[14px] text-black/80">
                            {opt.desc}
                          </span>
                          <span className="block mt-3 text-[14px] font-medium text-[#F88535]">
                            {CURRENCY} {CONSULTATION_FEES[opt.key]}
                          </span>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset className="mt-8">
                    <legend className="text-[15px] font-medium mb-3">
                      Mode
                    </legend>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {[
                        {
                          key: "online",
                          title: "Online",
                          desc: "Video consultation from your phone or computer.",
                        },
                        {
                          key: "offline",
                          title: "In person",
                          desc: "Visit the hospital for your appointment.",
                        },
                      ].map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setMode(opt.key)}
                          aria-pressed={mode === opt.key}
                          className={
                            "text-left rounded-2xl p-5 border-2 transition-colors " +
                            (mode === opt.key
                              ? "border-[#F88535] bg-[#F88535]/10"
                              : "border-black/10 hover:border-black/30")
                          }
                        >
                          <span className="block font-medium text-[16px]">
                            {opt.title}
                          </span>
                          <span className="block mt-1 text-[14px] text-black/80">
                            {opt.desc}
                          </span>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset className="mt-8">
                    <legend className="text-[15px] font-medium mb-3">
                      Your details
                    </legend>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label
                          htmlFor="dateOfBirth"
                          className="block text-[15px] font-medium mb-1.5"
                        >
                          Date of birth
                        </label>
                        <input
                          id="dateOfBirth"
                          type="date"
                          required
                          value={dateOfBirth}
                          onChange={(e) => setDateOfBirth(e.target.value)}
                          className="w-full rounded-xl border border-black/20 px-4 py-3 text-[16px]
                                     focus:outline-none focus:border-[#F88535] focus:ring-1 focus:ring-[#F88535]"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="sex"
                          className="block text-[15px] font-medium mb-1.5"
                        >
                          Sex
                        </label>
                        <select
                          id="sex"
                          required
                          value={sex}
                          onChange={(e) => setSex(e.target.value)}
                          className="w-full rounded-xl border border-black/20 bg-white px-4 py-3 text-[16px]
                                     focus:outline-none focus:border-[#F88535] focus:ring-1 focus:ring-[#F88535]"
                        >
                          <option value="" disabled>
                            Select sex
                          </option>
                          <option value="female">Female</option>
                          <option value="male">Male</option>
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor="location"
                          className="block text-[15px] font-medium mb-1.5"
                        >
                          Location
                        </label>
                        <input
                          id="location"
                          type="text"
                          required
                          value={location}
                          onChange={(e) => setLocation(e.target.value)}
                          placeholder="e.g. Berekum, Kato"
                          className="w-full rounded-xl border border-black/20 px-4 py-3 text-[16px]
                                     focus:outline-none focus:border-[#F88535] focus:ring-1 focus:ring-[#F88535]"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="phone"
                          className="block text-[15px] font-medium mb-1.5"
                        >
                          Phone number (WhatsApp preferred)
                        </label>
                        <input
                          id="phone"
                          type="tel"
                          required
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="e.g. 024 000 0000"
                          className="w-full rounded-xl border border-black/20 px-4 py-3 text-[16px]
                                     focus:outline-none focus:border-[#F88535] focus:ring-1 focus:ring-[#F88535]"
                        />
                        <p className="mt-1.5 text-[13px] text-black/60">
                          We'll also use this number for your mobile money
                          payment.
                        </p>
                      </div>
                    </div>
                  </fieldset>

                  {/* Error sits with the button that produced it. */}
                  <div className="mt-10">
                    <ErrorMessage error={error} innerRef={errorRef} />
                    <button
                      type="button"
                      onClick={handleContinueFromDetails}
                      disabled={loading}
                      className="w-full sm:w-auto rounded-full bg-[#F88535] text-white text-[16px] font-medium px-7 py-3.5
                                 hover:brightness-95 active:brightness-90 transition disabled:opacity-60"
                    >
                      {loading
                        ? "Setting up your booking…"
                        : "Continue to payment"}
                    </button>
                  </div>
                </section>
              )}

              {/* ---------- Step 1: pay online via Flutterwave ---------- */}
              {step === 1 && booking && (
                <section>
                  {!paying && paymentState !== "pending" && (
                    <BackButton onClick={() => goToStep(0)}>
                      Back to consultation details
                    </BackButton>
                  )}

                  <h2 className="font-display text-[22px] sm:text-[24px] font-medium">
                    Pay for your consultation
                  </h2>
                  <p className="mt-2 text-[16px] text-black/80">
                    Payment is by mobile money and goes straight to the
                    hospital. You'll get a prompt on your phone to approve it,
                    and your booking is created the moment the payment clears.
                  </p>

                  <div className="mt-7 rounded-2xl border border-black/10 p-6 sm:p-7 space-y-5">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[15px] text-black/80">
                        Consultation
                      </span>
                      <span className="text-right text-[16px] font-medium">
                        {type === "OPD" ? "General OPD" : "Surgical"}
                        <span className="block text-[14px] font-normal text-black/60">
                          {mode === "online" ? "Online" : "In person"}
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4 border-t border-black/10 pt-5">
                      <span className="text-[15px] text-black/80">
                        Amount due
                      </span>
                      <span className="font-display text-[20px] font-medium">
                        {booking.currency} {booking.amount}
                      </span>
                    </div>
                  </div>

                  <p className="mt-5 text-[14px] bg-[#0095D9] px-4 py-2.5 rounded text-white leading-relaxed">
                    Your booking is only created once we've confirmed the
                    payment, so please don't close this page until it's done.
                  </p>

                  {/* Awaiting-network state: payment left the phone but the
                      server hasn't confirmed it yet. No booking yet. */}
                  {paymentState === "pending" && (
                    <div
                      role="status"
                      className="mt-6 rounded-2xl border border-[#0095D9]/40 bg-[#0095D9]/5 px-5 py-4 text-[15px] text-black/80"
                    >
                      <span className="font-medium text-black">
                        Waiting for the network to confirm your payment.
                      </span>{" "}
                      This can take up to a few minutes. Keep this page open —
                      we'll finish your booking as soon as it clears.
                    </div>
                  )}

                  <div className="mt-8">
                    <ErrorMessage error={error} innerRef={errorRef} />

                    <div className="flex flex-wrap items-center gap-3">
                      {paymentState === "pending" ? (
                        <button
                          type="button"
                          onClick={handleCheckPaymentStatus}
                          disabled={paying}
                          className="inline-flex items-center gap-2 rounded-full bg-[#F88535] text-white text-[16px] font-medium px-7 py-3.5
                                     hover:brightness-95 active:brightness-90 transition disabled:opacity-60"
                        >
                          {paying && <Spinner />}
                          {paying
                            ? "Checking payment…"
                            : "Check payment status"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handlePay}
                          disabled={paying}
                          className="inline-flex items-center gap-2 rounded-full bg-[#F88535] text-white text-[16px] font-medium px-7 py-3.5
                                     hover:brightness-95 active:brightness-90 transition disabled:opacity-60"
                        >
                          {paying && <Spinner />}
                          {payButtonLabel}
                        </button>
                      )}

                      {paymentState === "checkout" && (
                        <span className="text-[14px] text-black/60">
                          Approve the prompt on your phone to continue.
                        </span>
                      )}
                    </div>

                    <p className="mt-4 text-[13px] text-black/60">
                      Payments are processed by Flutterwave. We never see or
                      store your mobile money PIN.
                    </p>
                  </div>
                </section>
              )}

              {/* ---------- Step 2: payment confirmed ---------- */}
              {step === 2 && booking && (
                <section className="text-center sm:text-left">
                  <div className="mx-auto sm:mx-0 h-14 w-14 rounded-full bg-[#0095D9]/10 flex items-center justify-center">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M5 13l4 4l10-10"
                        stroke="#0095D9"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <h2 className="mt-5 font-display text-[22px] sm:text-[24px] font-medium">
                    Payment confirmed, your booking is in
                  </h2>
                  <p className="mt-2 text-[16px] text-black/80 max-w-md mx-auto sm:mx-0">
                    We've received {booking.currency} {booking.amount}. Our team
                    will call or WhatsApp you on {phone || "your number"} with
                    your appointment time and doctor.
                  </p>

                  <div className="mt-7 rounded-2xl border border-black/10 px-5 py-4 max-w-md mx-auto sm:mx-0 text-left">
                    <span className="block text-[14px] text-black/60">
                      Paid
                    </span>
                    <span className="mt-0.5 block font-display text-[19px] font-medium">
                      {booking.currency} {booking.amount} by mobile money
                    </span>
                    <span className="mt-1 block text-[14px] text-black/60">
                      A receipt has been sent to you by Flutterwave.
                    </span>
                  </div>

                  <p className="mt-6 text-[14px] text-black/60 max-w-md mx-auto sm:mx-0">
                    Your consultation ID comes through with your appointment
                    details once a doctor and time are assigned. You can see
                    this booking any time from your account.
                  </p>

                  <div className="mt-8 flex flex-wrap justify-center sm:justify-start gap-3">
                    <Link
                      to="/"
                      className="rounded-full border border-black/20 text-[16px] font-medium px-6 py-3
                                 hover:border-black/40 transition"
                    >
                      Back to home
                    </Link>
                    <button
                      type="button"
                      onClick={resetFlow}
                      className="rounded-full bg-[#F88535] text-white text-[16px] font-medium px-6 py-3
                                 hover:brightness-95 active:brightness-90 transition"
                    >
                      Book another consultation
                    </button>
                  </div>
                </section>
              )}
            </div>
          </main>

          <Footer />
        </div>
      </div>
    </div>
  );
}
