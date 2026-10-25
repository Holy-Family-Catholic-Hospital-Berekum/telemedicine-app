import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";

import { db } from "../../src/firebase";
import { useAuth } from "../../src/context/authContext.jsx";
import Header from "../shared/header";
import Footer from "../shared/footer";
// Fixed, auto-slideshow brand panel — see BrandAside.jsx.
import BrandAside from "../shared/brandAside";
import { useSiteSettings } from "../../src/siteSettings";
import { useListedDoctors } from "../../src/doctorDirectory";
import { callableMessage } from "../../src/constants";
import { usePageMeta } from "../../src/seo.js";
import { openPaystackCheckout } from "../../src/paystackCheckout";
import {
  bookingPayload,
  detailsError,
  localPhone,
  needsAgeMonths,
  parseYears,
} from "./bookingForm";
import {
  createBookingDraft,
  fetchBookingStatus,
  initializePayment,
  waitForConfirmation,
} from "./booking/bookingService";
import { ErrorMessage } from "./booking/bookingUi";
import StepIndicator from "./booking/stepIndicator";
import ChoiceCards from "./booking/choiceCards";
import DoctorPicker from "./booking/doctorPicker";
import OnTimeNotice from "./booking/onTimeNotice";
import ConsentFields from "./booking/consentFields";
import PaymentStep from "./booking/paymentStep";
import BookingDone from "./booking/bookingDone";

/**
 * bookConsultation.jsx
 * Patient-facing booking flow, lives at "/book" behind a ProtectedRoute
 * (signed-in patient with a verified email).
 */

/**
 * ── DOCTOR SELECTION ─────────────────────────────────────────────────
 * Optional. Collapsed by default behind a "Choose your own doctor" toggle
 * — the doctor list only renders once the patient opens it, so step 0 stays
 * short for the common case (no preference, staff assign someone). If they
 * arrived here from a doctor's "Select this doctor" button on the home
 * page (Home.jsx → `/book?doctor=<id>`), that doctor is pre-selected and
 * the picker starts closed since there's nothing left to choose.
 *
 * The URL (`doctor`, `type`, `mode`, `slotId`) is read once, in the
 * useState initialisers, rather than in an effect — so arriving via a link
 * never triggers a second render pass just to copy the URL into state.
 *
 * The fee depends only on the mode, video call or hospital visit (siteSettings prices);
 * choosing a doctor doesn't change it. The amount actually charged is
 * always decided by the server.
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
 * "Check my payment" retry; a "failed" verdict keeps them on the
 * payment step so they can try again. In no branch does the patient get
 * a booking without a server-confirmed payment.
 *
 * The three calls this page makes — createBookingDraft,
 * initializePayment and getBookingStatus — are Firebase callable
 * functions (see functions/index.js). The secret key and the webhook
 * live there; nothing sensitive is in this file. Checkout is Paystack's
 * Inline popup, loaded on demand from inline.js.
 *
 * AMOUNTS, the one line that matters most in this whole file: Paystack
 * takes amounts in the smallest
 * currency unit — pesewas for GHS, not whole cedis. `booking.amount`
 * everywhere in this file is whole GHS (matching the server); the ×100
 * conversion happens at exactly one place, inside
 * openPaystackCheckout() in src/paystackCheckout.js, right where the popup is configured.
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
 * "Back to home" link, and Sign out when logged in). Header reads auth
 * state itself (useAuth()) and handles its own sign-out, so this page
 * doesn't manage that state itself.
 *
 * Consultation prices come from useSiteSettings() (live, admin-editable);
 * the Paystack public key from VITE_PAYSTACK_PUBLIC_KEY (the SECRET key
 * stays server-side only).
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
 * patient receives it by email (and on their dashboard) once scheduled.
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
 * Step 0 ends with a required consent checkbox showing the versioned text
 * from src/consentText.js. The page sends only the version it displayed;
 * createBookingDraft stores a consent record with that version, a hash of
 * the server's copy of the text, the server time, IP and browser.
 */

const CURRENCY = "GHS";

const STEP_LABELS = ["Your details", "Pay", "Done"];

const TYPE_OPTIONS = [
  {
    key: "OPD",
    title: "General OPD",
    desc: "Everyday health concerns and check-ups.",
  },
  {
    key: "SURGICAL",
    title: "Surgical",
    desc: "Before or after an operation.",
  },
];

const MODE_OPTIONS = [
  {
    key: "online",
    title: "Video call",
    desc: "Talk to the doctor on your phone or computer.",
  },
  {
    key: "in_person",
    title: "At the hospital",
    desc: "Come to the hospital to see the doctor.",
  },
];


export default function BookConsultation() {
  usePageMeta({ title: "Book a consultation", noindex: true });
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const { settings } = useSiteSettings();
  const { user, profile } = useAuth();

  // Heads-up only: an earlier booking with a payment attempt that isn't
  // confirmed yet. createBookingDraft refuses a new booking in that case;
  // this just tells the patient before they fill in the form.
  const [unconfirmedPayment, setUnconfirmedPayment] = useState(false);
  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    getDocs(
      query(
        collection(db, "bookings"),
        where("patientUid", "==", user.uid),
        where("status", "==", "awaiting_payment"),
      ),
    )
      .then((snap) => {
        const cutoff = Date.now() - 30 * 60 * 1000;
        const pending = snap.docs.some((d) => {
          const b = d.data();
          return (b.txRefs || []).length > 0 && (b.lastAttemptAt?.toMillis?.() ?? 0) > cutoff;
        });
        if (active) setUnconfirmedPayment(pending);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user]);
  const prices = settings.prices; // { online, in_person } — live, admin-editable

  // { message, id } — the id makes repeated identical errors re-announce.
  const [error, setError] = useState(null);
  const errorRef = useRef(null);
  const errorId = useRef(0);
  const scrollRef = useRef(null);

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

  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const opts = { top: 0, behavior: reduce ? "auto" : "smooth" };
    scrollRef.current?.scrollTo(opts);
    window.scrollTo(opts); // harmless fallback if the layout ever changes
  }, [step]);

  // Pre-selected: General OPD + Online, the most common path. If the page
  // was opened from a link (`?type=` / `?mode=`), that choice wins — read
  // once here rather than in an effect.
  const [type, setType] = useState(() => {
    const t = searchParams.get("type");
    return t === "OPD" || t === "SURGICAL" ? t : "OPD";
  }); // "OPD" | "SURGICAL"
  const [mode, setMode] = useState(() => {
    const m = searchParams.get("mode");
    return m === "online" || m === "in_person" ? m : "online";
  }); // "online" | "in_person"
  // Who the consultation is for. Accounts belong to adults; a parent or
  // guardian books for a child under 18 and consents for them (Ghana Data
  // Protection Act, 2012 (Act 843)). The server enforces the same rules.
  const [forChild, setForChild] = useState(false);
  const [childName, setChildName] = useState("");
  const [guardianConsent, setGuardianConsent] = useState(false);
  // Age (hospital decision: age, not date of birth). Months as well for a
  // child under 2 (doctors need it for babies).
  const [ageYears, setAgeYears] = useState("");
  const [ageMonths, setAgeMonths] = useState("");
  const needsMonths = needsAgeMonths(parseYears(ageYears));
  const [sex, setSex] = useState("");
  const [town, setTown] = useState("");
  const [area, setArea] = useState("");
  // Starts with the account's phone number (saved as +233…, shown the
  // familiar way, 024…); the patient can change it for this booking.
  const [phone, setPhone] = useState(() => localPhone(profile?.phone));
  // Required before continuing to payment — see handleContinueFromDetails
  // and the "Your information" fieldset in step 0.
  const [consent, setConsent] = useState(false);

  // ---------- Doctor selection ----------
  // null = no preference, staff assign someone. Picker starts closed; it
  // only opens when the patient asks for it, or is pre-filled (and left
  // closed) by a `?doctor=<id>` link from the home page.
  const { doctors } = useListedDoctors();
  // An id from the URL that isn't a listed doctor simply never matches
  // (selectedDoctor stays null), so nothing invalid reaches the server.
  const [selectedDoctorId, setSelectedDoctorId] = useState(
    () => searchParams.get("doctor") || null,
  );
  const [doctorPickerOpen, setDoctorPickerOpen] = useState(false);
  const [doctorSearch, setDoctorSearch] = useState("");

  // Slot the patient claimed from the dashboard's "open slots" list, if
  // they arrived here that way (see patientAvailableSlots.jsx). Threaded
  // through to createBookingDraft below so the server converts this
  // specific held slot into a booking (open -> held -> booked, per 4.8)
  // instead of creating an unrelated fresh one. Read-only: it comes from
  // the URL and never changes during the flow.
  const [slotId] = useState(() => searchParams.get("slotId") || null);
  // A claimed slot fixes the doctor, type and mode (the admin chose that
  // pairing when opening it): the patient can't change them here, and the
  // server refuses a different doctor or type. Read from the slot itself
  // (open slots are public), not trusted from the link.
  const slotLocked = Boolean(slotId);
  const [slotProblem, setSlotProblem] = useState(null);
  useEffect(() => {
    if (!slotId) return undefined;
    let active = true;
    // Inside the promise: a malformed slotId from the link throws in doc().
    Promise.resolve()
      .then(() => getDoc(doc(db, "availableSlots", slotId)))
      .then((snap) => {
        if (!active) return;
        const slot = snap.exists() ? snap.data() : null;
        if (!slot || slot.status !== "open") {
          setSlotProblem("This appointment time is no longer available. Please choose another time.");
          return;
        }
        if (slot.type === "OPD" || slot.type === "SURGICAL") setType(slot.type);
        if (slot.mode === "online" || slot.mode === "in_person") setMode(slot.mode);
        setSelectedDoctorId(slot.doctorUid || null);
      })
      .catch(() => {}); // the server checks the slot again when booking
    return () => {
      active = false;
    };
  }, [slotId]);

  // Admin switch. A slot claimed from the dashboard still carries its
  // doctor (the admin chose that pairing when opening the slot).
  const doctorChoiceAllowed = settings.doctorSelectionEnabled || Boolean(slotId);
  const selectedDoctor = doctorChoiceAllowed
    ? doctors.find((d) => d.id === selectedDoctorId) || null
    : null;

  // If the consultation type changes to one the currently-selected doctor
  // doesn't take (e.g. an OPD-only GP after switching to Surgical), drop
  // the selection rather than silently keep an invalid pairing. Done in
  // the click handler, not an effect, so there's no extra render pass.
  function handleTypeChange(nextType) {
    setType(nextType);
    const picked = doctors.find((d) => d.id === selectedDoctorId);
    if (picked && !picked.availableFor.includes(nextType)) {
      setSelectedDoctorId(null);
    }
  }

  const doctorsForType = useMemo(
    () => doctors.filter((d) => d.availableFor.includes(type)),
    [doctors, type],
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

  // What we ask for depends on how they'll see the doctor (bookingForm.js).
  // Every booking asks for a phone number, used only to contact the patient
  // (Paystack's own window asks for the mobile money number). When the
  // admin has switched in-person payment off, a hospital visit is booked
  // without paying. The server applies the same rules.
  const online = mode === "online";
  const payAtHospital = mode === "in_person" && !settings.inPersonPaymentRequired;
  const stepLabels = payAtHospital
    ? ["Your details", "Pay at the hospital", "Done"]
    : STEP_LABELS;

  // { bookingId, amount, currency, status, payAtHospital }
  const [booking, setBooking] = useState(null);

  // "idle" | "starting" | "checkout" | "verifying" | "pending" | "confirmed"
  const [paymentState, setPaymentState] = useState("idle");

  // Live estimate before a booking draft exists: the site's price for this
  // mode. Once a booking exists, its server-returned amount is authoritative.
  const liveFee = prices[mode];
  const fee = booking?.amount ?? liveFee;
  const paying =
    paymentState === "starting" ||
    paymentState === "checkout" ||
    paymentState === "verifying";

  function goToStep(n) {
    clearError();
    setStep(n);
  }

  // The details form, as bookingForm.js checks and sends it.
  const form = {
    type,
    mode,
    forChild,
    childName,
    ageYears,
    ageMonths,
    sex,
    town,
    area,
    phone,
    consent,
    guardianConsent,
    doctorUid: selectedDoctor?.id,
    slotId,
  };
  const buildPayload = () => bookingPayload(form);

  async function handleContinueFromDetails() {
    const problem = detailsError(form);
    if (problem) {
      showError(problem);
      return;
    }
    clearError();
    // Paid bookings: nothing is saved yet. The booking is created on the
    // server only when the patient taps Pay (handlePay), and it becomes a
    // confirmed booking only when Paystack confirms the money.
    if (!payAtHospital) {
      setBooking(null);
      setPaymentState("idle");
      setStep(1);
      return;
    }
    setLoading(true);
    try {
      const payload = buildPayload();
      const result = await createBookingDraft(payload);
      setBooking(result);
      setPaymentState("idle");
      // A free hospital visit is booked already: nothing to pay here.
      setStep(result.status === "booked" ? 2 : 1);
    } catch (err) {
      showError(
        callableMessage(
          err,
          "We couldn't set up your booking. Check your connection and try again.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  // Only ever called on the SERVER's "confirmed".
  function paymentConfirmed() {
    setPaymentState("confirmed");
    setStep(2);
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
    let current = booking;
    try {
      // First tap on Pay: create the booking on the server (it waits for
      // the payment; if the payment never goes through, it is deleted).
      if (!current) {
        current = await createBookingDraft(buildPayload());
        setBooking(current);
      }
      const session = await initializePayment({ bookingId: current.bookingId });
      // An earlier attempt on this booking turned out to have succeeded.
      if (session.status === "confirmed") {
        paymentConfirmed();
        return;
      }

      setPaymentState("checkout");
      const result = await openPaystackCheckout({
        reference: session.reference,
        amount: session.amount,
        currency: session.currency,
        customer: session.customer,
      });

      if (result.status === "cancelled") {
        // They closed the popup without paying — but a MoMo prompt can
        // still be sitting on their handset, so check once before
        // declaring nothing happened.
        setPaymentState("verifying");
        const check = await fetchBookingStatus(current.bookingId);
        if (check.status === "confirmed") {
          paymentConfirmed();
          return;
        }
        setPaymentState("idle");
        showError(
          "Payment was cancelled, so your booking isn't confirmed. You can start the payment again below.",
        );
        return;
      }

      setPaymentState("verifying");
      const verdict = await waitForConfirmation(current.bookingId);

      if (verdict.status === "confirmed") {
        paymentConfirmed();
        return;
      }
      if (verdict.status === "pending") {
        setPaymentState("pending");
        return;
      }

      setPaymentState("idle");
      setBooking(null); // the server deleted the failed attempt
      showError(
        verdict.message ||
          "Your payment didn't go through, so no booking was made. Try again below.",
      );
    } catch (err) {
      setPaymentState("idle");
      showError(
        callableMessage(
          err,
          "We couldn't reach the payment service. Your booking isn't confirmed, please try again.",
        ),
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
        paymentConfirmed();
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
      setBooking(null); // the server deleted the failed attempt
      showError(
        verdict.message ||
          "That payment didn't complete, so no booking was made. You can start it again below.",
      );
    } catch {
      setPaymentState("pending");
      showError("We couldn't check your payment just now. Try again shortly.");
    }
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
        .font-display { font-family: 'Fraunces Variable', 'Fraunces', serif; }
        .font-body { font-family: 'Inter Variable', 'Inter', sans-serif; }
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
        body="Choose the care you need, pay with mobile money, and we send you your appointment time by email."
        points={[
          "General OPD or Surgical",
          "Pay with mobile money (MoMo)",
          "Your appointment time comes by email",
        ]}
      />

      {/* Right-hand column: pushed clear of the fixed aside, and the
          scroll container for the sticky header. Needs `h-screen`, not
          `min-h-screen` — see the original note: min-h lets the div grow
          past the viewport so it never scrolls itself, which breaks the
          sticky header. */}
      <div
        ref={scrollRef}
        className="lg:ml-[340px] xl:ml-[380px] h-screen flex flex-col overflow-y-auto"
      >
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
              <p className="text-[15px] font-medium uppercase tracking-wide text-white/90">
                Book a consultation
              </p>
              <h1 className="mt-1 font-display text-[24px] sm:text-[28px] font-medium">
                {stepLabels[step]}
              </h1>
            </div>
          </div>

          <main className="mx-auto max-w-3xl px-5 sm:px-8 py-8 sm:py-12 w-full">
            <StepIndicator stepLabels={stepLabels} step={step} />

            <div
              key={step}
              className="motion-safe:[animation:stepIn_0.35s_ease-out_both]"
            >
              {/* ---------- Step 0: consultation details ---------- */}
              {step === 0 && (
                <section>
                  {unconfirmedPayment && (
                    <div
                      role="status"
                      className="mb-6 rounded-2xl border border-[#F88535]/50 bg-[#F88535]/10 px-5 py-4 text-[16px] text-black/80"
                    >
                      We are still waiting for an earlier payment to go through.
                        So you don't pay twice, please wait for it before you
                        book again.{" "}
                      <Link to="/dashboard" className="font-medium text-[#0095D9] underline">
                        Check it on your dashboard
                      </Link>
                      .
                    </div>
                  )}
                  <h2 className="font-display text-[22px] sm:text-[24px] font-medium">
                    What kind of consultation do you need?
                  </h2>
                  <p className="mt-2 text-[16px] text-black/80">
                    You can choose a doctor, or let the hospital choose one for
                    you.
                  </p>

                  <ChoiceCards
                    legend="Consultation type"
                    options={TYPE_OPTIONS}
                    value={type}
                    onChange={handleTypeChange}
                    locked={slotLocked}
                  >
                    {slotLocked && (
                      <p className="-mt-1 mb-3 text-[15px] text-black/75">
                        You chose an appointment time, so the type, the way you
                        see the doctor and the doctor are set by that time.
                      </p>
                    )}
                    {slotProblem && (
                      <p role="alert" className="-mt-1 mb-3 text-[15px] font-medium text-[#B42318]">
                        {slotProblem}
                      </p>
                    )}
                  </ChoiceCards>

                  <ChoiceCards
                    legend="How do you want to see the doctor?"
                    options={MODE_OPTIONS}
                    value={mode}
                    onChange={setMode}
                    locked={slotLocked}
                  />

                  {doctorChoiceAllowed && (
                    <DoctorPicker
                      doctorPickerOpen={doctorPickerOpen}
                      setDoctorPickerOpen={setDoctorPickerOpen}
                      selectedDoctor={selectedDoctor}
                      setSelectedDoctorId={setSelectedDoctorId}
                      slotLocked={slotLocked}
                      doctorSearch={doctorSearch}
                      setDoctorSearch={setDoctorSearch}
                      filteredDoctors={filteredDoctors}
                    />
                  )}

                  <fieldset className="mt-8">
                    <legend className="text-[17px] font-semibold mb-3">
                      Who is this consultation for?
                    </legend>
                    <div className="grid grid-cols-2 gap-3" role="radiogroup">
                      {[
                        { value: false, label: "Myself" },
                        { value: true, label: "My child (under 18)" },
                      ].map((o) => (
                        <button
                          key={o.label}
                          type="button"
                          role="radio"
                          aria-checked={forChild === o.value}
                          onClick={() => {
                            setForChild(o.value);
                            if (!o.value) setGuardianConsent(false);
                          }}
                          className={`rounded-xl border-2 px-4 py-3.5 text-[16px] font-medium transition ${
                            forChild === o.value
                              ? "border-[#F88535] bg-[#F88535]/10 text-black"
                              : "border-black/15 text-black/80 hover:border-black/30"
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                    {forChild && (
                      <p className="mt-3 text-[16px] text-black/75">
                        As the child's parent or legal guardian, you book and
                        pay from your account, and the details below are your
                        child's. Please be with your child during the
                        consultation.
                      </p>
                    )}
                  </fieldset>

                  <fieldset className="mt-8">
                    <legend className="text-[16px] font-medium mb-3">
                      {forChild ? "Your child's details" : "Your details"}
                    </legend>
                    {forChild && (
                      <div className="mb-4">
                        <label
                          htmlFor="childName"
                          className="block text-[16px] font-medium mb-1.5"
                        >
                          Child's full name
                        </label>
                        <input
                          id="childName"
                          type="text"
                          required
                          maxLength={100}
                          value={childName}
                          onChange={(e) => setChildName(e.target.value)}
                          className="w-full rounded-xl border border-black/20 px-4 py-3 text-[16px]
                                     focus:outline-none focus:border-[#F88535] focus:ring-1 focus:ring-[#F88535]"
                        />
                      </div>
                    )}
                    {online && (
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label
                          htmlFor="ageYears"
                          className="block text-[16px] font-medium mb-1.5"
                        >
                          {forChild ? "Child's age (years)" : "Your age (years)"}
                        </label>
                        <div className="flex gap-3">
                          <input
                            id="ageYears"
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            maxLength={3}
                            placeholder={forChild ? "e.g. 6" : "e.g. 34"}
                            value={ageYears}
                            onChange={(e) => {
                              setAgeYears(e.target.value.replace(/\D/g, ""));
                              setAgeMonths("");
                            }}
                            className="w-full rounded-xl border border-black/20 px-4 py-3 text-[16px]
                                       focus:outline-none focus:border-[#F88535] focus:ring-1 focus:ring-[#F88535]"
                          />
                          {needsMonths && (
                            <select
                              id="ageMonths"
                              aria-label="And months"
                              value={ageMonths}
                              onChange={(e) => setAgeMonths(e.target.value)}
                              className="w-full rounded-xl border border-black/20 bg-white px-4 py-3 text-[16px]
                                         focus:outline-none focus:border-[#F88535] focus:ring-1 focus:ring-[#F88535]"
                            >
                              <option value="" disabled>
                                and months
                              </option>
                              {Array.from({ length: 12 }, (_, m) => (
                                <option key={m} value={m}>
                                  {m} {m === 1 ? "month" : "months"}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                        {needsMonths && (
                          <p className="mt-1.5 text-[14px] text-[#3E4E56]">
                            Under 2: please also choose the months (e.g. 1 year and 4 months).
                          </p>
                        )}
                      </div>

                      <div>
                        <label
                          htmlFor="sex"
                          className="block text-[16px] font-medium mb-1.5"
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
                          htmlFor="town"
                          className="block text-[17px] font-medium mb-2"
                        >
                          Town or city
                        </label>
                        <input
                          id="town"
                          type="text"
                          required
                          autoComplete="address-level2"
                          value={town}
                          onChange={(e) => setTown(e.target.value)}
                          placeholder="e.g. Berekum"
                          className="w-full rounded-xl border border-black/30 px-4 py-3.5 text-[18px]
               focus:outline-none focus:border-[#F88535] focus:ring-2 focus:ring-[#F88535]"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="area"
                          className="block text-[17px] font-medium mb-2"
                        >
                          Area or neighbourhood
                        </label>
                        <input
                          id="area"
                          type="text"
                          required
                          autoComplete="address-level3"
                          value={area}
                          onChange={(e) => setArea(e.target.value)}
                          placeholder="e.g. Kato, Senase, Biadan"
                          className="w-full rounded-xl border border-black/30 px-4 py-3.5 text-[18px]
               focus:outline-none focus:border-[#F88535] focus:ring-2 focus:ring-[#F88535]"
                        />
                        <p className="mt-2 text-[16px] text-black/75">
                          The part of town you live in, or a landmark close to
                          you.
                        </p>
                      </div>

                    </div>
                    )}

                    {/* Contact number only (Paystack asks for the mobile
                        money number in its own window). */}
                      <div className={`${online || forChild ? "mt-4 " : ""}sm:max-w-sm`}>
                        <label
                          htmlFor="phone"
                          className="block text-[16px] font-medium mb-1.5"
                        >
                          Phone number
                        </label>
                        <input
                          id="phone"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          required
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="e.g. 024 000 0000"
                          className="w-full rounded-xl border border-black/20 px-4 py-3 text-[16px]
                                     focus:outline-none focus:border-[#F88535] focus:ring-1 focus:ring-[#F88535]"
                        />
                        <p className="mt-1.5 text-[15px] text-black/75">
                          We'll call this number if we need to reach you about
                          your appointment.
                        </p>
                      </div>
                  </fieldset>

                  {payAtHospital && (
                    <div className="mt-8 rounded-2xl border border-[#0095D9]/30 bg-[#0095D9]/5 p-5">
                      <p className="text-[16px] font-medium">No payment now</p>
                      <p className="mt-1.5 text-[16px] text-black/80">
                        You pay {CURRENCY} {fee} at the hospital when you come
                        for your visit.
                      </p>
                    </div>
                  )}

                  <OnTimeNotice settings={settings} online={online} payAtHospital={payAtHospital} />

                  <ConsentFields
                    consent={consent}
                    setConsent={setConsent}
                    forChild={forChild}
                    guardianConsent={guardianConsent}
                    setGuardianConsent={setGuardianConsent}
                  />

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
                        ? payAtHospital
                          ? "Booking your visit…"
                          : "Setting up your booking…"
                        : payAtHospital
                          ? "Book my visit"
                          : "Next: pay"}
                    </button>
                  </div>
                </section>
              )}

              {/* ---------- Step 1: pay online via Paystack ---------- */}
              {step === 1 && (
                <PaymentStep
                  paying={paying}
                  paymentState={paymentState}
                  onBack={() => {
                    // Details may change: the next Pay starts afresh.
                    setBooking(null);
                    setPaymentState("idle");
                    goToStep(0);
                  }}
                  type={type}
                  mode={mode}
                  selectedDoctor={selectedDoctor}
                  booking={booking}
                  fee={fee}
                  currency={CURRENCY}
                  error={error}
                  errorRef={errorRef}
                  handleCheckPaymentStatus={handleCheckPaymentStatus}
                  handlePay={handlePay}
                  payButtonLabel={payButtonLabel}
                />
              )}

              {/* ---------- Step 2: payment confirmed ---------- */}
              {step === 2 && booking && (
                <BookingDone booking={booking} selectedDoctor={selectedDoctor} />
              )}
            </div>
          </main>

          <Footer />
        </div>
      </div>

    </div>
  );
}
