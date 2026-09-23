import { useCallback, useRef, useState } from "react";

/**
 * DEV-ONLY stand-in for functions/index.js and the real Paystack popup.
 *
 * Why this exists: running Cloud Functions needs Firebase on the Blaze
 * (pay-as-you-go) plan. Until that's activated, createBookingDraft /
 * initializePayment / getBookingStatus can't run for real. This module
 * fakes their behaviour — same request/response shapes, similar async
 * timing — purely so the booking + payment SCREENS in bookConsultation.jsx
 * can be previewed. It makes no network calls, stores nothing real, and
 * everything resets on page refresh.
 *
 * Swap it out: in bookConsultation.jsx, flip USE_MOCK_BACKEND to false once
 * Cloud Functions are deployed. Nothing else in that file has to change —
 * these functions mirror the real callables' shape, and useMockCheckout()
 * stands in for openPaystackCheckout().
 */

// In-memory "database" of draft bookings, just for this browser tab.
const draftBookings = new Map();

function randomId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

// Mirrors createBookingDraft. The real version has the server compute the
// fee; the mock can't do that, so bookConsultation.jsx passes the
// client-computed fee in ONLY when USE_MOCK_BACKEND is on (see the
// doctorTier/baseFee fields it adds to the payload there) — never send a
// client-computed fee to the real function.
export async function mockCreateBookingDraft({ type, mode, doctorId, baseFee }) {
  await new Promise((r) => setTimeout(r, 700));

  const bookingId = randomId("bk");
  draftBookings.set(bookingId, {
    bookingId,
    type,
    mode,
    doctorId: doctorId || null,
    status: "draft",
    amount: baseFee,
    currency: "GHS",
  });

  return { bookingId, amount: baseFee, currency: "GHS" };
}

export async function mockInitializePayment({ bookingId }) {
  await new Promise((r) => setTimeout(r, 500));
  const draft = draftBookings.get(bookingId);
  if (!draft) throw new Error("Unknown booking (mock backend was reset).");

  return {
    reference: randomId("ref"),
    amount: draft.amount,
    currency: draft.currency,
    customer: { email: "patient@example.com", phone: "", name: "" },
  };
}

export async function mockGetBookingStatus(bookingId) {
  await new Promise((r) => setTimeout(r, 400));
  const draft = draftBookings.get(bookingId);
  if (!draft) return { status: "failed", message: "Booking not found." };
  return { status: draft.status };
}

function markBookingStatus(bookingId, status) {
  const draft = draftBookings.get(bookingId);
  if (draft) draft.status = status;
}

/**
 * Stands in for openPaystackCheckout(). Instead of loading Paystack's
 * script, it renders an in-page modal with a button per outcome, so you can
 * preview every downstream screen — confirmed, pending → confirmed, failed,
 * cancelled — on demand.
 *
 * const { open, modal } = useMockCheckout();
 * // in handlePay: const result = await open({ bookingId, reference, amount, currency });
 * // in JSX, once, near the bottom of the component: {modal}
 */
export function useMockCheckout() {
  const [session, setSession] = useState(null); // { bookingId, reference, amount, currency }
  const resolveRef = useRef(null);

  const open = useCallback((sessionInfo) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setSession(sessionInfo);
    });
  }, []);

  function settle(result) {
    setSession(null);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    if (resolve) resolve(result);
  }

  function choose(outcome) {
    if (!session) return;
    const { bookingId } = session;

    if (outcome === "success") {
      markBookingStatus(bookingId, "confirmed");
      settle({ status: "successful", transactionId: randomId("txn") });
      return;
    }
    if (outcome === "pending") {
      // Simulate MoMo taking a while: the status flips to confirmed a few
      // seconds after the popup closes, so waitForConfirmation()'s polling
      // (or a manual "Check payment status" click) has something to catch.
      markBookingStatus(bookingId, "pending");
      setTimeout(() => markBookingStatus(bookingId, "confirmed"), 6000);
      settle({ status: "successful", transactionId: randomId("txn") });
      return;
    }
    if (outcome === "failed") {
      markBookingStatus(bookingId, "failed");
      settle({ status: "successful", transactionId: randomId("txn") });
      return;
    }
    // cancel — popup closed with no charge attempted
    settle({ status: "cancelled" });
  }

  const modal = session ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Mock Paystack checkout"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-black/50">
          Mock Paystack checkout (dev only)
        </p>
        <p className="mt-2 font-display text-[22px] font-medium">
          {session.currency} {session.amount}
        </p>
        <p className="mt-1 text-[13px] text-black/60">
          Mobile money · Ref {session.reference}
        </p>

        <div className="mt-6 space-y-2.5">
          <button
            type="button"
            onClick={() => choose("success")}
            className="w-full rounded-xl bg-[#0095D9] px-4 py-3 text-[15px] font-medium text-white hover:brightness-95"
          >
            Simulate: payment approved
          </button>
          <button
            type="button"
            onClick={() => choose("pending")}
            className="w-full rounded-xl border border-black/15 px-4 py-3 text-[15px] font-medium hover:border-black/30"
          >
            Simulate: delayed confirmation
          </button>
          <button
            type="button"
            onClick={() => choose("failed")}
            className="w-full rounded-xl border border-[#F88535]/40 px-4 py-3 text-[15px] font-medium text-[#A85420] hover:border-[#F88535]"
          >
            Simulate: payment failed
          </button>
          <button
            type="button"
            onClick={() => choose("cancel")}
            className="w-full px-4 py-2 text-[14px] text-black/50 hover:text-black/70"
          >
            Close popup without paying
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { open, modal };
}
