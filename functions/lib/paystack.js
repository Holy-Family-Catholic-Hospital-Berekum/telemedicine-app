// functions/lib/paystack.js
//
// The Paystack secret and the Refund API, shared by payments.js (automatic
// refunds of duplicate / late payments), refunds.js (refunds an admin
// approves) and the refund status sync.
//
// A refund always goes back to the ORIGINAL payment (the patient's mobile
// money wallet or card), identified by our payment reference; never to a
// number typed in. Amounts are whole GHS here; x100 to pesewas happens only
// in createRefund.
//
// Paystack refund statuses: pending -> processing -> processed, or failed
// (and "needs-attention" when the Paystack balance can't cover it; it
// completes once funds arrive). The Paystack docs are the reference:
// https://paystack.com/docs/api/refund/

const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

const PAYSTACK_SECRET_KEY = defineSecret("PAYSTACK_SECRET_KEY");
const PAYSTACK_API = "https://api.paystack.co";

// Trimmed so a stray newline from pasting doesn't break authentication.
const secretKey = () => PAYSTACK_SECRET_KEY.value().trim();

/** Paystack status -> ours: "processing" | "refunded" | "failed". */
function refundOutcome(status) {
  if (status === "processed") return "refunded";
  if (status === "failed" || status === "reversed") return "failed";
  return "processing";
}

/**
 * Asks Paystack to refund `amount` GHS of the payment `reference`.
 * Resolves { id, status }; throws an Error with Paystack's message.
 */
async function createRefund({ reference, amount, customerNote, merchantNote }) {
  const res = await fetch(`${PAYSTACK_API}/refund`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transaction: reference,
      amount: Math.round(Number(amount) * 100),
      currency: "GHS",
      customer_note: String(customerNote || "Refund from Holy Family Catholic Hospital").slice(0, 200),
      merchant_note: String(merchantNote || "").slice(0, 200),
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.status) {
    const message = body?.message || `Paystack refund failed (${res.status})`;
    logger.error("Paystack refund request failed", { reference, status: res.status, message });
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return { id: String(body.data?.id ?? ""), status: body.data?.status || "pending" };
}

/** Current state of a refund; resolves Paystack's data object or null. */
async function fetchRefund(id) {
  const res = await fetch(`${PAYSTACK_API}/refund/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${secretKey()}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    logger.warn("Paystack refund lookup failed", { id, status: res.status });
    return null;
  }
  return body?.data || null;
}

module.exports = { PAYSTACK_SECRET_KEY, PAYSTACK_API, secretKey, refundOutcome, createRefund, fetchRefund };
