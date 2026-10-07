// functions/reconcile.js
//
//   reconcilePaystack  daily safety net: asks Paystack for every successful
//                      payment of the last RECONCILE_DAYS days and makes
//                      sure each of ours was handled.
//
// Normally Paystack's signed webhook (or the patient's own check) records a
// payment within seconds. If that message is ever lost (a wrong webhook
// address in the Paystack dashboard, an outage longer than Paystack's
// retries), a patient could be charged with nothing recorded and no
// refund. This job closes that gap: any successful payment with one of our
// references (HFH-...) that is neither a recorded payment
// (confirmedPayments) nor a flagged one (paymentIssues) is applied exactly
// as the webhook would (applyPaystackTransaction): it confirms the booking
// or fee if that's still possible, otherwise it is flagged and refunded
// automatically. Payments already recorded are skipped, so a closed
// consultation's payment is never mistaken for an unknown one.
// Other payments on the same Paystack account (not ours) are ignored.

const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { db, audit } = require("./lib/core");
const { PAYSTACK_SECRET_KEY, PAYSTACK_API, secretKey } = require("./lib/paystack");
const {
  applyPaystackTransaction,
  verifyPaystackTransaction,
  isOurReference,
} = require("./payments");

const RECONCILE_DAYS = 3;
const PER_PAGE = 100;
const MAX_PAGES = 50; // 5,000 payments: far above a few days' volume

async function listSuccessfulTransactions(fromIso) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${PAYSTACK_API}/transaction?status=success&from=${encodeURIComponent(fromIso)}&perPage=${PER_PAGE}&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${secretKey()}` } });
    const body = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(body?.data)) {
      throw new Error(`Paystack transaction list failed (${res.status})`);
    }
    out.push(...body.data);
    const pageCount = Number(body.meta?.pageCount || 1);
    if (page >= pageCount || body.data.length < PER_PAGE) break;
  }
  return out;
}

exports.reconcilePaystack = onSchedule(
  {
    schedule: "every day 02:00",
    timeZone: "Africa/Accra",
    secrets: [PAYSTACK_SECRET_KEY],
    timeoutSeconds: 540,
  },
  async () => {
    const from = new Date(Date.now() - RECONCILE_DAYS * 86400 * 1000).toISOString();
    const listed = await listSuccessfulTransactions(from);
    const ours = [...new Set(listed.map((t) => t?.reference).filter(isOurReference))];

    const found = { applied: [], flagged: [] };
    for (const reference of ours) {
      const [paid, issue] = await Promise.all([
        db.collection("confirmedPayments").doc(reference).get(),
        db.collection("paymentIssues").doc(reference).get(),
      ]);
      if (paid.exists || issue.exists) continue; // already handled

      try {
        // Never trust the list's numbers either: re-read this one.
        const tx = await verifyPaystackTransaction(reference, secretKey());
        if (tx?.reference !== reference || tx.status !== "success") continue;
        const outcome = await applyPaystackTransaction(tx, "reconcile");
        if (outcome === "applied" || outcome === "flagged") found[outcome].push(reference);
      } catch (err) {
        logger.error("Reconciliation: one payment failed", { reference, err: err.message });
      }
    }

    logger.info("Paystack reconciliation done", {
      listed: listed.length,
      ours: ours.length,
      applied: found.applied.length,
      flagged: found.flagged.length,
    });
    if (found.applied.length || found.flagged.length) {
      // Something slipped past the webhook: worth an admin's attention.
      await audit(null, {
        action: `Daily payment check found ${found.applied.length + found.flagged.length} payment(s) the webhook had missed`,
        code: "payment.reconciled",
        category: "payment",
        result: "failed",
        details: { applied: found.applied.slice(0, 50), flagged: found.flagged.slice(0, 50) },
      });
    }
  },
);
