import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
import { useSiteSettings } from "../../src/siteSettings";

// Doctor directory + fee table. See those files for the data shape and for
// notes on swapping mock data for a Firestore `doctorProfiles` read.
import doctors from "../../src/data/doctors";
import { specialistSurcharge } from "../../src/data/consultationFees";

// DEV-ONLY mock of the Cloud Functions + Paystack popup — see that file for
// why it exists and how to turn it off.
import {
  mockCreateBookingDraft,
  mockInitializePayment,
  mockGetBookingStatus,
  useMockCheckout,
} from "../../src/mockPaymentBackend";

/**
 * bookConsultation.jsx
 * Patient-facing booking flow, lives at "/book".
 * Assumes the patient is already signed in and email-verified (per the
 * architecture, accounts are created before booking) — wrap this route in
 * whatever auth guard / protected route pattern the rest of the app uses.
 *
 * ── DEV MODE: NO CLOUD FUNCTIONS YET ────────────────────────────────
 * Cloud Functions need Firebase's Blaze plan, which isn't activated yet.
 * USE_MOCK_BACKEND below swaps createBookingDraft / initializePayment /
 * getBookingStatus for in-memory fakes, and swaps the real Paystack popup
 * for an on-screen mock with buttons for each outcome (approved, delayed,
 * failed, cancelled) — see src/mockPaymentBackend.jsx. Flip it to false
 * once Cloud Functions are deployed; nothing else in this file needs to
 * change, since the mock functions mirror the real callables' shapes.
 */
const USE_MOCK_BACKEND = true;

/**
 * ── DOCTOR SELECTION ─────────────────────────────────────────────────
 * Optional. Collapsed by default behind a "Choose your own doctor" toggle
 * — the doctor list only renders once the patient opens it, so step 0 stays
 * short for the common case (no preference, staff assign someone). If they
 * arrived here from a doctor's "Select this doctor" button on the home
 * page (Home.jsx → `/book?doctor=<id>`), that doctor is pre-selected and
 * the picker starts closed since there's nothing left to choose.
 *
 * A specialist doctor costs more than a general doctor for the same
 * consultation type — see src/data/consultationFees.js. Switching type or
 * removing/changing the doctor recalculates the fee live; only the amount
 * actually charged is ever decided by the server.
 *
 * ── PAYMENT MODEL (Paystack) ─────────────────────────────────────────
 * Payment is collected ONLINE through Paystack (mobile money), which
 * settles straight into the hospital's Paystack account. There is no
 * manual "send us the money and paste your transaction ID" step.
 *
 * The rule the UI enforces: a booking is only ever created/confirmed
 * once OUR SERVER says the payment is confirmed. The client never
 * decides this. Paystack's browser-side callback is treated purely as a
 * hint that the charge finished — it is not proof. The server calls
 * Paystack's verify endpoint (and/or trusts the webhook) and returns the
 * verdict, and only a "confirmed" verdict advances the patient to the
 * success step. A "pending" verdict parks them on a waiting state with a
 * "Check payment status" retry; a "failed" verdict keeps them on the
 * payment step so they can try again. In no branch does the patient get
 * a booking without a server-confirmed payment. (In dev, the mock
 * checkout stands in for the server's verdict — see USE_MOCK_BACKEND.)
 *
 * The three calls this page makes — createBookingDraft,
 * initializePayment and getBookingStatus — are Firebase callable
 * functions (see functions/index.js). The secret key and the webhook
 * live there; nothing sensitive is in this file. Checkout is Paystack's
 * Inline popup, loaded on demand from inline.js.
 *
 * MIGRATION NOTE (Flutterwave → Paystack), the one line that matters
 * most in this whole file: Paystack takes amounts in the smallest
 * currency unit — pesewas for GHS, not whole cedis. `booking.amount`
 * everywhere in this file is whole GHS (matching the server); the ×100
 * conversion happens at exactly one place, inside
 * openPaystackCheckout() below, right where the popup is configured.
 * Nowhere else in this file should multiply or divide by 100.
 *
 * ── ERROR VISIBILITY ─────────────────────────────────────────────────
 * Errors render directly above the control that triggered them (not at
 * the top of the page), and on every new error the banner is scrolled
 * into view and focused — see errorRef + the effect below. It's
 * role="alert" + aria-live="assertive" and focusable (tabIndex -1), so
 * screen readers announce it immediately. Errors are stored as
 * { message, id }; the id increments on every setError so re-submitting
 * with the same mistake re-triggers the scroll/announce.
 *
 * ── LAYOUT ───────────────────────────────────────────────────────────
 * BrandAside is `position: fixed` (see that file), so it never scrolls.
 * Header, by contrast, is `sticky top-0` (see header.jsx) and is
 * rendered *inside* this page's own scrollable column — that's what
 * makes "sticky" work: it scrolls with the column until it hits the top,
 * then sticks there, rather than floating over content from outside it.
 * That means only one thing has to line up: this page's right-hand
 * column is pushed right by exactly the aside's width
 * (`lg:ml-[340px] xl:ml-[380px]`), so content never sits under the fixed
 * aside. No manual header-height offset is needed anywhere else.
 *
 * Uses Header with variant="minimal" — a focused-task header (logo, a
 * "Back to home" link, and Sign out when logged in). Header reads real
 * auth state internally (Firebase's onAuthStateChanged) and handles its
 * own sign-out, so this page doesn't manage that state itself.
 *
 * Placeholder values to update before shipping:
 * - CONSULTATION_FEES amounts (fallback only — live prices come from
 *   useSiteSettings())
 * - PAYSTACK_PUBLIC_KEY (keep the SECRET key server-side only)
 *
 * Defaults: General OPD + Online are pre-selected on step 0, since
 * that's the most common path through this flow.
 *
 * Identifiers are INTERNAL and are not shown to the patient. The draft
 * still carries a payment reference (minted server-side, one per payment
 * attempt) because Paystack needs a unique reference and our staff need
 * something to reconcile against — but the patient never has to copy,
 * keep or quote it, because Paystack verifies the payment for us. The
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
 *
 * ── DATA CONSENT ─────────────────────────────────────────────────────
 * Step 0 ends with a required consent checkbox before the patient can
 * continue to payment — validated the same way as the other required
 * fields in handleContinueFromDetails. It isn't just a boolean: the
 * payload sends consentGivenAt (an ISO timestamp taken at submit time),
 * so there's an actual record of when consent was given, not just that
 * a box was ticked at some point. See the TODO on createBookingDraft's
 * real Cloud Function about persisting this server-side.
 */

// Fallback shown for an instant before live prices arrive. Keep in step
// with DEFAULT_FEES in functions/siteSettings.js. These are GENERAL-tier
// prices; a specialist doctor adds specialistSurcharge(type) on top — see
// src/data/consultationFees.js.
const CONSULTATION_FEES = { OPD: 250, SURGICAL: 300 };

const CURRENCY = "GHS";

// Your Paystack PUBLIC key. This one is meant to be visible in the
// browser — it can only start a payment, never read or move money. Put
// it in .env as VITE_PAYSTACK_PUBLIC_KEY. The SECRET key lives only in
// Cloud Functions and must never appear anywhere in this app.
const PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;

// Paystack's inline checkout script. Loaded on demand, once.
const PAYSTACK_SCRIPT = "https://js.paystack.co/v1/inline.js";

// Must match the region your functions are deployed to.
const FUNCTIONS_REGION = "europe-west1";

const STEP_LABELS = ["Consultation", "Payment", "Confirmation"];

/* ===================================================================
   BACKEND CALLS

   Note what is NOT here: no amount is ever sent up to the server, and
   nothing in this file can mark a booking as paid. The server reads the
   fee from its own table and decides, on its own, whether money arrived.
   Everything below either asks the server (or, in dev, the mock) a
   question, or opens the Paystack popup (or, in dev, its mock).
   =================================================================== */

// Only touches Cloud Functions when they can actually be called — avoids
// requiring a working Functions deployment just to preview the UI.
const fns = USE_MOCK_BACKEND ? null : getFunctions(app, FUNCTIONS_REGION);
const callCreateBookingDraft = fns && httpsCallable(fns, "createBookingDraft");
const callInitializePayment = fns && httpsCallable(fns, "initializePayment");
const callGetBookingStatus = fns && httpsCallable(fns, "getBookingStatus");

// Creates an unpaid booking draft. The server computes the fee — we only
// send what the patient actually chose (including which doctor, if any).
// Resolves: { bookingId, amount, currency }
async function createBookingDraft(payload) {
  if (USE_MOCK_BACKEND) return mockCreateBookingDraft(payload);
  const { data } = await callCreateBookingDraft(payload);
  return data;
}

// Mints a fresh, single-use payment reference for this booking and
// returns what the popup needs. A new reference per attempt is what
// makes retries after a failed payment safe.
// Resolves: { reference, amount, currency, customer }
async function initializePayment({ bookingId }) {
  if (USE_MOCK_BACKEND) return mockInitializePayment({ bookingId });
  const { data } = await callInitializePayment({ bookingId });
  return data;
}

// Loads js.paystack.co/v1/inline.js once and caches the promise.
let paystackScriptPromise = null;
function loadPaystack() {
  if (window.PaystackPop) return Promise.resolve();
  if (paystackScriptPromise) return paystackScriptPromise;

  paystackScriptPromise = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = PAYSTACK_SCRIPT;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      paystackScriptPromise = null;
      reject(new Error("Could not load Paystack checkout."));
    };
    document.body.appendChild(el);
  });
  return paystackScriptPromise;
}

/**
 * Opens the inline popup and resolves once it's done, one way or another.
 *
 * What comes back here is a HINT, nothing more. A determined user can
 * tamper with things on their end, so we hand this result to no one and
 * ask the server what really happened instead (see handlePay below). The
 * popup closing is our cue to start asking — not evidence of anything.
 *
 * MIGRATION NOTE: `amount` is passed in from the caller as whole GHS
 * (same unit as booking.amount everywhere else). Paystack wants pesewas,
 * so the ×100 happens right here, once, and only here — if you ever see
 * a payment for 100x or 1/100th of the right amount, this line is the
 * first place to look.
 *
 * Resolves: { status: "successful", transactionId } | { status: "cancelled" }
 */
async function openPaystackCheckout({ reference, amount, currency, customer }) {
  await loadPaystack();

  return new Promise((resolve) => {
    // Paystack can call `callback` and then still fire `onClose` as the
    // popup tears itself down — this guard makes sure we only resolve
    // once, on whichever fires first, rather than assuming a strict
    // callback-then-onClose order the way the Flutterwave integration
    // could.
    let settled = false;
    function settle(result) {
      if (settled) return;
      settled = true;
      resolve(result);
    }

    const handler = window.PaystackPop.setup({
      key: PAYSTACK_PUBLIC_KEY,
      email: customer?.email || "",
      amount: Math.round(amount * 100), // GHS -> pesewas, see migration note above
      currency,
      ref: reference,
      // Ghana mobile money only. Add "card" to this array if you later
      // want to accept cards too.
      channels: ["mobile_money"],
      metadata: {
        custom_fields: [
          {
            display_name: "Phone",
            variable_name: "phone",
            value: customer?.phone || "",
          },
          {
            display_name: "Name",
            variable_name: "name",
            value: customer?.name || "",
          },
        ],
      },
      callback: (response) => {
        settle({ status: "successful", transactionId: response?.reference });
      },
      onClose: () => {
        settle({ status: "cancelled" });
      },
    });

    handler.openIframe();
  });
}

// Asks the server where this booking stands. The server re-verifies with
// Paystack when it hasn't heard from the webhook yet, so this is a real
// check and not just a database read.
// Resolves: { status: "confirmed" | "pending" | "failed", message? }
async function fetchBookingStatus(bookingId) {
  if (USE_MOCK_BACKEND) return mockGetBookingStatus(bookingId);
  const { data } = await callGetBookingStatus({ bookingId });
  return data;
}

/**
 * Polls for a verdict after the popup closes.
 *
 * Why polling: MoMo confirmations are asynchronous. The charge can be
 * approved on the patient's handset seconds before Paystack finishes
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

// Small round doctor portrait used in the "current selection" summary and
// in each row of the picker. Falls back to initials, same idea as
// DoctorPortrait on the home page, just circular and smaller.
function DoctorAvatar({ doctor, size = 44 }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(doctor.image) && !failed;

  return (
    <div
      className="shrink-0 overflow-hidden rounded-full bg-[#0095D9] flex items-center justify-center text-white font-medium"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {showImage ? (
        <img
          src={doctor.image}
          alt=""
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        doctor.initials
      )}
    </div>
  );
}

export default function BookConsultation() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const { settings } = useSiteSettings();
  const prices = settings.prices; // { OPD, SURGICAL } — live, admin-editable

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
  // Required before continuing to payment — see handleContinueFromDetails
  // and the "Your information" fieldset in step 0.
  const [consent, setConsent] = useState(false);

  // ---------- Doctor selection ----------
  // null = no preference, staff assign someone. Picker starts closed; it
  // only opens when the patient asks for it, or is pre-filled (and left
  // closed) by a `?doctor=<id>` link from the home page.
  const [selectedDoctorId, setSelectedDoctorId] = useState(null);
  const [doctorPickerOpen, setDoctorPickerOpen] = useState(false);
  const [doctorSearch, setDoctorSearch] = useState("");

  useEffect(() => {
    const doctorParam = searchParams.get("doctor");
    if (doctorParam && doctors.some((d) => d.id === doctorParam)) {
      setSelectedDoctorId(doctorParam);
    }
    // Only read the URL once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedDoctor = doctors.find((d) => d.id === selectedDoctorId) || null;

  // If the consultation type changes to one the currently-selected doctor
  // doesn't take (e.g. an OPD-only GP after switching to Surgical), drop
  // the selection rather than silently keep an invalid pairing.
  useEffect(() => {
    if (selectedDoctor && !selectedDoctor.availableFor.includes(type)) {
      setSelectedDoctorId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const doctorsForType = useMemo(
    () => doctors.filter((d) => d.availableFor.includes(type)),
    [type],
  );

  const filteredDoctors = useMemo(() => {
    const q = doctorSearch.trim().toLowerCase();
    if (!q) return doctorsForType;
    return doctorsForType.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.role.toLowerCase().includes(q) ||
        d.specialties.some((s) => s.toLowerCase().includes(q)),
    );
  }, [doctorsForType, doctorSearch]);

  // { bookingId, amount, currency }
  const [booking, setBooking] = useState(null);

  // "idle" | "starting" | "checkout" | "verifying" | "pending" | "confirmed"
  const [paymentState, setPaymentState] = useState("idle");
  const [payment, setPayment] = useState(null); // { reference, transactionId }

  // Live estimate before a booking draft exists: the site's general-tier
  // price for this type, plus a specialist surcharge if the chosen doctor
  // is a specialist. Once a booking exists, its server-returned amount is
  // authoritative.
  const liveFee =
    prices[type] +
    (selectedDoctor?.tier === "specialist" ? specialistSurcharge(type) : 0);
  const fee = booking?.amount ?? liveFee;
  const paying =
    paymentState === "starting" ||
    paymentState === "checkout" ||
    paymentState === "verifying";

  // Dev-only mock checkout modal — see src/mockPaymentBackend.jsx. `modal`
  // is only ever non-null while USE_MOCK_BACKEND is true and a checkout is
  // in progress.
  const { open: openMockCheckout, modal: mockCheckoutModal } =
    useMockCheckout();

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
    if (!consent) {
      showError(
        "Please confirm you agree to how we use your information before continuing.",
      );
      return;
    }
    clearError();
    setLoading(true);
    try {
      const payload = {
        type,
        mode,
        dateOfBirth,
        sex,
        location,
        phone,
        doctorId: selectedDoctorId || null,
        // Timestamp taken at submit time, not just a boolean — this is
        // the actual record of when consent was given. See TODO note on
        // createBookingDraft: the real Cloud Function must persist this
        // against the booking, not just accept and discard it.
        consentGivenAt: new Date().toISOString(),
      };
      // The real function computes the fee itself from doctorId; these two
      // extra fields only exist so the mock backend (which has no server
      // logic of its own) knows what fee to hand back. Never send a
      // client-computed fee to the real endpoint.
      if (USE_MOCK_BACKEND) {
        payload.doctorTier = selectedDoctor?.tier ?? "general";
        payload.baseFee = liveFee;
      }
      const result = await createBookingDraft(payload);
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
   * The whole payment path: mint a reference, open the popup, then wait
   * for the SERVER to say the money arrived. The patient only reaches
   * step 2 on a server-confirmed payment — there is deliberately no
   * branch here that trusts the popup's own result.
   */
  async function handlePay() {
    clearError();
    setPaymentState("starting");
    try {
      const session = await initializePayment({ bookingId: booking.bookingId });

      setPaymentState("checkout");
      const result = USE_MOCK_BACKEND
        ? await openMockCheckout({
            bookingId: booking.bookingId,
            reference: session.reference,
            amount: session.amount,
            currency: session.currency,
          })
        : await openPaystackCheckout({
            reference: session.reference,
            amount: session.amount,
            currency: session.currency,
            customer: session.customer,
          });

      setPayment({
        reference: session.reference,
        transactionId: result.transactionId,
      });

      if (result.status === "cancelled") {
        // They closed the popup without paying — but a MoMo prompt can
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
        "We couldn't reach the payment service. Your booking isn't confirmed, please try again.",
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
    setConsent(false);
    setSelectedDoctorId(null);
    setDoctorPickerOpen(false);
    setDoctorSearch("");
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
        heading={
          step === 2
            ? "You're all set."
            : "Quality Healthcare at Your Door Step."
        }
        body="Pick a consultation type, pay securely by mobile money, and our team shares your appointment directly with you."
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
                    You'll pay on the next step. Choose a doctor now if you'd
                    like, or we'll assign one once your payment is confirmed.
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
                            {CURRENCY} {prices[opt.key]}
                            <span className="font-normal text-black/50">
                              {" "}
                              general · {CURRENCY}{" "}
                              {prices[opt.key] + specialistSurcharge(opt.key)}{" "}
                              specialist
                            </span>
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

                  {/* ---------- Doctor (optional) ---------- */}
                  <fieldset className="mt-8">
                    <legend className="text-[15px] font-medium mb-3">
                      Doctor
                    </legend>

                    {!doctorPickerOpen && (
                      <div className="rounded-2xl border-2 border-[#0095D9] p-5 flex items-center justify-between gap-4 flex-wrap">
                        {selectedDoctor ? (
                          <div className="flex items-center gap-3">
                            <DoctorAvatar doctor={selectedDoctor} />
                            <div>
                              <p className="font-medium text-[15px]">
                                {selectedDoctor.name}
                              </p>
                              <p className="text-[13px] text-black/60">
                                {selectedDoctor.role}
                                {selectedDoctor.tier === "specialist" && (
                                  <span className="ml-2 rounded-full bg-[#F88535]/10 px-2 py-0.5 text-[11px] font-medium text-[#A85420]">
                                    Specialist
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[14px] text-black/70 max-w-sm">
                            We'll assign you the best available doctor for this
                            consultation. Want to choose your own?
                          </p>
                        )}
                        <div className="flex items-center gap-4">
                          {selectedDoctor && (
                            <button
                              type="button"
                              onClick={() => setSelectedDoctorId(null)}
                              className="text-[13.5px] font-medium text-black/50 hover:text-black/70"
                            >
                              Remove
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setDoctorPickerOpen(true)}
                            className="text-[14px] bg-[#F88535] cursor-pointer p-2 rounded-full font-medium text-white hover:underline"
                          >
                            {selectedDoctor
                              ? "Change doctor"
                              : "Choose your own doctor"}
                          </button>
                        </div>
                      </div>
                    )}

                    {doctorPickerOpen && (
                      <div className="rounded-2xl border-2 border-[#F88535]/40 p-5">
                        <div className="flex items-center gap-3">
                          <label htmlFor="doctorSearch" className="sr-only">
                            Search by name or specialty
                          </label>
                          <input
                            id="doctorSearch"
                            type="text"
                            value={doctorSearch}
                            onChange={(e) => setDoctorSearch(e.target.value)}
                            placeholder="Search by name or specialty"
                            className="flex-1 rounded-xl border border-black/20 px-4 py-2.5 text-[15px]
                                       focus:outline-none focus:border-[#F88535] focus:ring-1 focus:ring-[#F88535]"
                          />
                          <button
                            type="button"
                            onClick={() => setDoctorPickerOpen(false)}
                            className="text-[13.5px] font-medium text-black/50 hover:text-black/70 shrink-0"
                          >
                            Close
                          </button>
                        </div>

                        <div className="mt-4 grid sm:grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
                          {filteredDoctors.map((doc) => (
                            <button
                              key={doc.id}
                              type="button"
                              onClick={() => {
                                setSelectedDoctorId(doc.id);
                                setDoctorPickerOpen(false);
                                setDoctorSearch("");
                              }}
                              className="text-left rounded-xl border border-black/10 p-4 hover:border-[#F88535] transition"
                            >
                              <div className="flex items-center gap-3">
                                <DoctorAvatar doctor={doc} />
                                <div className="min-w-0">
                                  <p className="font-medium text-[14.5px] truncate">
                                    {doc.name}
                                  </p>
                                  <p className="text-[13px] text-black/60 truncate">
                                    {doc.role}
                                  </p>
                                </div>
                                {doc.tier === "specialist" && (
                                  <span className="ml-auto shrink-0 rounded-full bg-[#F88535]/10 px-2.5 py-1 text-[11px] font-medium text-[#A85420]">
                                    Specialist
                                  </span>
                                )}
                              </div>
                              <p className="mt-2 text-[12.5px] text-black/60">
                                {doc.specialties.join(" · ")}
                              </p>
                              <p className="mt-1 text-[12.5px] font-medium text-[#F88535]">
                                {CURRENCY}{" "}
                                {prices[type] +
                                  (doc.tier === "specialist"
                                    ? specialistSurcharge(type)
                                    : 0)}
                              </p>
                            </button>
                          ))}
                          {filteredDoctors.length === 0 && (
                            <p className="col-span-full text-[14px] text-black/60 py-4 text-center">
                              No doctors match "{doctorSearch}" for this
                              consultation type.
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    <p className="mt-2 text-[13px] text-black/60">
                      {selectedDoctor?.tier === "specialist"
                        ? `Specialist consultations are ${CURRENCY} ${specialistSurcharge(
                            type,
                          )} more than a general doctor.`
                        : "Choosing a specific doctor only changes the fee if they're a specialist."}
                    </p>
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

                  {/* ---------- Data consent ---------- */}
                  <fieldset className="mt-8 rounded-2xl border border-black/10 p-5">
                    <legend className="text-[15px] font-medium mb-2 px-1">
                      Your information
                    </legend>
                    <p className="text-[14px] text-black/70">
                      We collect your date of birth, sex, location and phone
                      number to set up this consultation, assign a doctor, and
                      contact you about your appointment. Clinical details you
                      share are visible only to the doctor handling your
                      consultation. Payment is handled by Paystack — we don't
                      see or store your mobile money PIN. Consultation records
                      are deleted once your consultation is marked complete;
                      only anonymised, non-identifying metrics are kept
                      afterward.
                    </p>
                    <label className="mt-4 flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-black/30 text-[#F88535] focus:ring-[#F88535]"
                      />
                      <span className="text-[14.5px] text-black/80">
                        I agree to Holy Family Catholic Hospital collecting and
                        using my information as described above to provide this
                        consultation.{" "}
                        <Link
                          to="/privacy"
                          target="_blank"
                          className="underline text-[#0095D9] hover:text-[#0077ad]"
                        >
                          Read our privacy policy
                        </Link>
                        .
                      </span>
                    </label>
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

              {/* ---------- Step 1: pay online via Paystack ---------- */}
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
                      <span className="text-[15px] text-black/80">Doctor</span>
                      {selectedDoctor ? (
                        <span className="flex items-center gap-2.5 text-right">
                          <DoctorAvatar doctor={selectedDoctor} size={32} />
                          <span className="text-[15px] font-medium">
                            {selectedDoctor.name}
                            {selectedDoctor.tier === "specialist" && (
                              <span className="block text-[12.5px] font-normal text-[#A85420]">
                                Specialist
                              </span>
                            )}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[15px] text-black/60">
                          To be assigned
                        </span>
                      )}
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

                  {USE_MOCK_BACKEND && (
                    <p className="mt-4 text-[13px] rounded-lg bg-black/5 px-4 py-2.5 text-black/60">
                      Dev preview: no Cloud Functions yet, so "Pay" opens a mock
                      checkout you can drive to any outcome.
                    </p>
                  )}

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

                      {paymentState === "checkout" && !USE_MOCK_BACKEND && (
                        <span className="text-[14px] text-black/60">
                          Approve the prompt on your phone to continue.
                        </span>
                      )}
                    </div>

                    <p className="mt-4 text-[13px] text-black/60">
                      Payments are processed by Paystack. We never see or store
                      your mobile money PIN.
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
                    your appointment time{selectedDoctor ? "" : " and doctor"}.
                  </p>

                  <div className="mt-7 rounded-2xl border border-black/10 px-5 py-4 max-w-md mx-auto sm:mx-0 text-left space-y-3">
                    <div>
                      <span className="block text-[14px] text-black/60">
                        Paid
                      </span>
                      <span className="mt-0.5 block font-display text-[19px] font-medium">
                        {booking.currency} {booking.amount} by mobile money
                      </span>
                      <span className="mt-1 block text-[14px] text-black/60">
                        A receipt has been sent to you by Paystack.
                      </span>
                    </div>
                    {selectedDoctor && (
                      <div className="border-t border-black/10 pt-3 flex items-center gap-3">
                        <DoctorAvatar doctor={selectedDoctor} />
                        <div>
                          <span className="block text-[14px] font-medium">
                            {selectedDoctor.name}
                          </span>
                          <span className="block text-[13px] text-black/60">
                            {selectedDoctor.role}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <p className="mt-6 text-[14px] text-black/60 max-w-md mx-auto sm:mx-0">
                    Your consultation ID comes through with your appointment
                    details once{" "}
                    {selectedDoctor ? "a time is" : "a doctor and time are"}{" "}
                    assigned. You can see this booking any time from your
                    account.
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

      {/* Dev-only mock Paystack popup. Renders nothing when idle or when
          USE_MOCK_BACKEND is false. */}
      {mockCheckoutModal}
    </div>
  );
}
