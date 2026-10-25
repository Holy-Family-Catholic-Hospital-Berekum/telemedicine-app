import { httpsCallable } from "firebase/functions";
import { tracked } from "../../../src/networkStatus";
import { functions } from "../../../src/firebase";

/* ===================================================================
   BACKEND CALLS

   Note what is NOT here: no amount is ever sent up to the server, and
   nothing in this file can mark a booking as paid. The server reads the
   fee from its own table and decides, on its own, whether money arrived.
   =================================================================== */

const callCreateBookingDraft = tracked(httpsCallable(functions, "createBookingDraft"));
const callInitializePayment = tracked(httpsCallable(functions, "initializePayment"));
const callGetBookingStatus = tracked(httpsCallable(functions, "getBookingStatus"));

// Creates an unpaid booking draft. The server computes the fee — we only
// send what the patient actually chose (including which doctor, if any).
// Resolves: { bookingId, amount, currency, type, mode }
export async function createBookingDraft(payload) {
  const { data } = await callCreateBookingDraft(payload);
  return data;
}

// Mints a fresh, single-use payment reference for this booking and
// returns what the popup needs. A new reference per attempt is what
// makes retries after a failed payment safe.
// Resolves: { reference, amount, currency, customer }
export async function initializePayment({ bookingId }) {
  const { data } = await callInitializePayment({ bookingId });
  return data;
}

// Asks the server where this booking stands. The server re-verifies with
// Paystack when it hasn't heard from the webhook yet, so this is a real
// check and not just a database read.
// Resolves: { status: "confirmed" | "pending" | "failed", message? }
export async function fetchBookingStatus(bookingId) {
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
 * minute, then hand over to the manual "Check my payment" state.
 */
export async function waitForConfirmation(
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
