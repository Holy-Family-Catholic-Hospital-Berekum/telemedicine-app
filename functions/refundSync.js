// functions/refundSync.js
//
//   syncPaystackRefunds  every 15 min: re-reads every refund still in
//                        progress from Paystack and records the outcome
//   handleRefundEvent    the signed webhook's refund.* events (payments.js)
//                        trigger the same re-read straight away
//
// Paystack's own refund record is the source of truth: webhook bodies are
// only a hint to look again. Two kinds of refund are tracked:
//   paymentIssues   refund_starting | refund_processing -> refunded | refund_failed
//   refundRequests  refund_starting | processing        -> refunded | failed
// A refund stuck in "refund_starting" (the server stopped between asking
// Paystack and saving the answer) is matched by looking up the payment's
// refunds on Paystack, so it is neither lost nor repeated.

const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { db, serverTime, audit } = require("./lib/core");
const { PAYSTACK_SECRET_KEY, PAYSTACK_API, secretKey, fetchRefund, refundOutcome } = require("./lib/paystack");

const KINDS = {
  paymentIssues: {
    active: ["refund_processing", "refund_starting"],
    done: { refunded: "refunded", failed: "refund_failed" },
    processing: "refund_processing",
  },
  refundRequests: {
    active: ["processing", "refund_starting"],
    done: { refunded: "refunded", failed: "failed" },
    processing: "processing",
  },
};
const STUCK_MINUTES = 15;

/** Refunds Paystack holds for a transaction id (newest first). */
async function refundsForTransaction(transactionId) {
  if (!transactionId) return [];
  const res = await fetch(`${PAYSTACK_API}/refund?transaction=${encodeURIComponent(transactionId)}`, {
    headers: { Authorization: `Bearer ${secretKey()}` },
  });
  const body = await res.json().catch(() => null);
  return res.ok && Array.isArray(body?.data) ? body.data : [];
}

/** Brings one tracked refund up to date. */
async function syncOne(collection, doc) {
  const kind = KINDS[collection];
  const d = doc.data();
  let refund = d.paystackRefundId ? await fetchRefund(d.paystackRefundId) : null;

  if (!refund && d.status === "refund_starting") {
    const startedAt = d.refundStartingAt?.toMillis?.() ?? 0;
    if (Date.now() - startedAt < STUCK_MINUTES * 60 * 1000) return;
    const found = (await refundsForTransaction(d.transactionId))[0];
    if (!found) {
      // Paystack never got it: back to waiting for an admin.
      await doc.ref.update({
        status: collection === "paymentIssues" ? "refund_due" : "requested",
        lastRefundError: "The refund didn't reach Paystack. Try again.",
      });
      return;
    }
    refund = found;
  }
  if (!refund) return;

  const outcome = refundOutcome(refund.status);
  const updates = {
    paystackRefundId: String(refund.id ?? d.paystackRefundId ?? ""),
    paystackRefundStatus: refund.status || null,
    refundCheckedAt: serverTime(),
  };
  if (outcome === "processing") {
    if (d.status !== kind.processing) updates.status = kind.processing;
    await doc.ref.update(updates);
    return;
  }
  updates.status = kind.done[outcome];
  if (outcome === "refunded") {
    updates.amountRefunded = Number(refund.amount || 0) / 100 || d.amountRefunded || null;
    updates.refundedAt = serverTime();
  }
  await doc.ref.update(updates);
  await audit(null, {
    action: outcome === "refunded" ? "Paystack completed a refund" : "Paystack refund failed",
    code: outcome === "refunded" ? "payment.refund_completed" : "payment.refund_failed",
    category: "payment",
    result: outcome === "refunded" ? "success" : "failed",
    targetType: collection === "paymentIssues" ? "payment" : "consultation",
    targetId: doc.id,
    patientUid: d.patientUid || null,
    details: { paystackRefundId: updates.paystackRefundId, status: refund.status },
  });
}

async function syncAll() {
  for (const collection of Object.keys(KINDS)) {
    const snap = await db
      .collection(collection)
      .where("status", "in", KINDS[collection].active)
      .limit(200)
      .get();
    for (const doc of snap.docs) {
      try {
        await syncOne(collection, doc);
      } catch (err) {
        logger.error("Refund sync failed", { collection, id: doc.id, err: err.message });
      }
    }
  }
}

exports.syncPaystackRefunds = onSchedule(
  { schedule: "every 15 minutes", secrets: [PAYSTACK_SECRET_KEY], timeoutSeconds: 300 },
  syncAll,
);

/** Webhook refund.* event: re-read the matching refunds from Paystack. */
async function handleRefundEvent(data) {
  const refundId = data?.id != null ? String(data.id) : null;
  const reference = data?.transaction_reference || data?.transaction?.reference || null;
  for (const collection of Object.keys(KINDS)) {
    const matches = [];
    if (refundId) {
      const s = await db.collection(collection).where("paystackRefundId", "==", refundId).limit(5).get();
      matches.push(...s.docs);
    }
    if (!matches.length && typeof reference === "string" && /^HFH-[2-9A-Z]{6}-[A-Za-z0-9_-]{1,128}$/.test(reference)) {
      const field = collection === "paymentIssues" ? "reference" : "paystackReference";
      const s = await db.collection(collection).where(field, "==", reference).limit(5).get();
      matches.push(...s.docs);
    }
    for (const doc of matches) await syncOne(collection, doc);
  }
}

exports.handleRefundEvent = handleRefundEvent;
exports.syncAll = syncAll;
