// Paystack inline checkout, shared by the booking page and the no-show
// reschedule fee (patient dashboard). Only ever a hint: the server decides
// whether money arrived (signed webhook or verify by reference).

// Your Paystack PUBLIC key. This one is meant to be visible in the
// browser — it can only start a payment, never read or move money. Put
// it in .env as VITE_PAYSTACK_PUBLIC_KEY. The SECRET key lives only in
// Cloud Functions and must never appear anywhere in this app.
const PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;

// Paystack's inline checkout script. Loaded on demand, once.
const PAYSTACK_SCRIPT = "https://js.paystack.co/v1/inline.js";

// Loads js.paystack.co/v1/inline.js once and caches the promise.
let paystackScriptPromise = null;
export function loadPaystack() {
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
 * ask the server what really happened instead. The
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
export async function openPaystackCheckout({ reference, amount, currency, customer }) {
  if (!PAYSTACK_PUBLIC_KEY) {
    throw new Error("Payments aren't configured (VITE_PAYSTACK_PUBLIC_KEY is missing).");
  }
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
