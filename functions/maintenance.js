// functions/maintenance.js
//
// Scheduled housekeeping. Each job is small, idempotent and safe to rerun.
//
//   cleanupExpiredBookings  hourly: deletes unpaid drafts (and the personal
//                           details on them) once their window passes,
//                           after one last check with Paystack
//   releaseSlotHolds        every 15 min: returns abandoned slot holds
//   cleanupSignalling       hourly: removes call signalling docs past expiry
//   cleanupRateLimits       daily: removes old rate-limit counters, and
//                           cleans up patients deleted in the Firebase
//                           console (lib/accountDeletion.js)

// Run by jobs.js (one of three scheduled jobs), not deployed on its own.
const { task } = require("./lib/task");
const logger = require("firebase-functions/logger");
const { db, Timestamp, FieldValue, serverTime, deleteTree } = require("./lib/core");
const { sweepDeletedPatients } = require("./lib/accountDeletion");
const { checkAttempts, discardDraft, PAYSTACK_SECRET_KEY } = require("./payments");

const BATCH = 200;

exports.cleanupExpiredBookings = task("cleanupExpiredBookings", 
  { schedule: "every 60 minutes", secrets: [PAYSTACK_SECRET_KEY], timeoutSeconds: 300 },
  async () => {
    const snap = await db
      .collection("bookings")
      .where("status", "==", "awaiting_payment")
      .where("expiresAt", "<", Timestamp.now())
      .limit(BATCH)
      .get();

    let deleted = 0;
    for (const doc of snap.docs) {
      const booking = doc.data();

      // A mobile-money payment can land late. Last chance to honour it,
      // and never delete while a charge might still complete (try again
      // next run).
      // ("rejected": a wrong-amount payment, already flagged and refunded
      // on its own, so the draft goes like any other.)
      const state = await checkAttempts(doc.ref, booking);
      if (state === "paid" || state === "in_flight" || state === "unknown") {
        continue;
      }

      await discardDraft(doc.ref, booking, "expired");
      deleted++;
    }
    if (deleted) logger.info("Expired bookings deleted", { deleted });
  },
);

exports.releaseSlotHolds = task("releaseSlotHolds", "every 15 minutes", async () => {
  const snap = await db
    .collection("availableSlots")
    .where("status", "==", "held")
    .where("heldUntil", "<", Timestamp.now())
    .limit(BATCH)
    .get();
  for (const doc of snap.docs) {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      const slot = fresh.data();
      if (slot?.status !== "held") return;
      // Keep the hold if its booking has been paid in the meantime.
      if (slot.bookingId) {
        // deepcode ignore Sqli: Firestore document ID, not SQL; bookingId read from a server-written slot.
        const b = await tx.get(db.collection("bookings").doc(slot.bookingId));
        if (b.exists && b.data().status !== "awaiting_payment") return;
      }
      tx.update(doc.ref, {
        status: "open",
        heldByUid: FieldValue.delete(),
        heldUntil: FieldValue.delete(),
        bookingId: FieldValue.delete(),
        updatedAt: serverTime(),
      });
    });
  }
});

exports.cleanupSignalling = task("cleanupSignalling", "every 60 minutes", async () => {
  const snap = await db
    .collection("calls")
    .where("expiresAt", "<", Timestamp.now())
    .limit(BATCH)
    .get();
  await Promise.all(snap.docs.map((doc) => deleteTree(doc.ref)));
});

exports.cleanupRateLimits = task("cleanupRateLimits", { schedule: "every 24 hours", timeoutSeconds: 540 }, async () => {
  const snap = await db
    .collection("rateLimits")
    .where("expiresAt", "<", Timestamp.now())
    .limit(500)
    .get();
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  if (!snap.empty) await batch.commit();

  // Same daily run (no extra scheduled job): patients whose account was
  // deleted in the Firebase console are cleaned up like an admin's delete.
  const purged = await sweepDeletedPatients().catch((err) => {
    logger.error("Deleted-patient sweep failed", { err: err.message });
    return 0;
  });
  if (purged) logger.info("Deleted patient accounts cleaned up", { purged });
});
