// functions/lib/accountDeletion.js
//
// What happens to a patient's data when their account is deleted (an
// admin's "Delete patient", or the account deleted in the Firebase
// console, found by the daily sweep: accounts.js deletePatientAccount /
// sweepDeletedPatients below).
//
//   - Every booking of theirs is removed with its consultation, call room,
//     held slot and queued emails. A consultation that was scheduled is
//     closed through closeConsultation first, so a short history record is
//     kept like for any other consultation (outcome "cancelled", or
//     "no_show" for a held no-show), flagged accountDeleted.
//   - Money (hospital decision): every payment for a booking that never
//     took place (the patient and doctor were never connected) is refunded
//     IN FULL automatically, the consultation fee and any no-show fee,
//     through the same path as other payments we can't use (paymentIssues,
//     reason "account_deleted"). A refund already requested is settled by
//     that instead, never twice.
//   - Their prescriptions (and the signature copies on them) are deleted.
//   - Their profile (users/{uid}) is deleted.
//   - Kept, as for every consultation: consultationHistory, confirmedPayments,
//     consents, the audit log and recordings (financial/legal records).
// Idempotent: running it again finds nothing left to do.

const logger = require("firebase-functions/logger");
const { db, FieldValue, serverTime, audit, deleteTree } = require("./core");
const { closeConsultation } = require("./consultationLifecycle");

/** The Paystack payments on a booking that can still be refunded in full. */
function refundablePayments(booking) {
  const payments = [];
  if (booking.paystackReference && Number(booking.amountPaid) > 0) {
    payments.push({
      reference: booking.paystackReference,
      amount: Number(booking.amountPaid),
      id: booking.paystackTransactionId || null,
    });
  }
  if (booking.noShowFee?.reference && Number(booking.noShowFee.amount) > 0) {
    payments.push({ reference: booking.noShowFee.reference, amount: Number(booking.noShowFee.amount), id: null });
  }
  return payments;
}

/**
 * Removes a deleted patient's bookings (refunding what never took place)
 * and profile. actor: { uid, role } of whoever deleted the account
 * ("system" for a console delete). Resolves a summary for the audit log.
 */
async function purgePatientData(uid, { actor, meta = null }) {
  // Lazy: payments.js loads this module's callers too.
  const { recordPaymentIssue } = require("../payments");
  const summary = { bookings: 0, refunds: 0, closed: 0, prescriptions: 0 };

  // deepcode ignore Sqli: Firestore equality filter on the account's own uid (from Auth), not SQL.
  const bookings = await db.collection("bookings").where("patientUid", "==", uid).get();
  for (const doc of bookings.docs) {
    const b = doc.data();
    summary.bookings += 1;
    const tookPlace = Boolean(b.metAt);

    // 1. Refund in full what was paid for a consultation that never happened.
    if (!tookPlace && ["paid", "scheduled", "no_show"].includes(b.status)) {
      // A refund the patient already asked for settles it instead.
      let refundUnderWay = false;
      if (b.consultationId) {
        // deepcode ignore Sqli: Firestore document ID, not SQL; consultationId read from the server-written booking.
        const reqRef = db.collection("refundRequests").doc(b.consultationId);
        const req = await reqRef.get();
        if (req.exists) {
          const status = req.data().status;
          if (["refund_starting", "processing", "refunded"].includes(status)) {
            refundUnderWay = true;
          } else if (["requested", "failed"].includes(status)) {
            await reqRef.update({
              status: "declined",
              note: "Account deleted: refunded in full automatically.",
              resolvedByUid: actor.uid,
              resolvedAt: serverTime(),
            });
          }
        }
      }
      if (!refundUnderWay) {
        for (const p of refundablePayments(b)) {
          await recordPaymentIssue(
            { reference: p.reference, amount: Math.round(p.amount * 100), currency: b.currency || "GHS", id: p.id },
            { reason: "account_deleted", bookingId: doc.id, patientUid: uid },
          );
          summary.refunds += 1;
        }
      }
    }

    // 2. A consultation: close it (history kept), which also deletes the
    //    booking, the consultation and the call room.
    if (b.consultationId) {
      try {
        const closed = await closeConsultation({
          consultationId: b.consultationId,
          outcome: b.status === "no_show" ? "no_show" : "cancelled",
          actor,
          meta,
        });
        if (closed) {
          summary.closed += 1;
          // deepcode ignore Sqli: Firestore document ID, not SQL; consultationId read from the server-written booking.
          await db.collection("consultationHistory").doc(b.consultationId)
            .update({ accountDeleted: true })
            .catch(() => {});
        }
      } catch (err) {
        logger.warn("Closing a deleted patient's consultation failed; deleting it", {
          consultationId: b.consultationId,
          err: err.message,
        });
        // deepcode ignore Sqli: Firestore document ID, not SQL; consultationId read from the server-written booking.
        await deleteTree(db.collection("consultations").doc(b.consultationId)).catch(() => {});
        // deepcode ignore Sqli: Firestore document ID, not SQL; consultationId read from the server-written booking.
        await deleteTree(db.collection("calls").doc(b.consultationId)).catch(() => {});
      }
    }

    // 3. Whatever's left of the booking: a held slot back to open, queued
    //    emails, the booking itself.
    if (b.slotId) {
      // deepcode ignore Sqli: Firestore document ID, not SQL; slotId read from the server-written booking.
      const slotRef = db.collection("availableSlots").doc(b.slotId);
      await db.runTransaction(async (tx) => {
        const slot = await tx.get(slotRef);
        if (slot.exists && slot.data().bookingId === doc.id && ["held", "booked"].includes(slot.data().status)) {
          tx.update(slotRef, {
            status: "open",
            heldByUid: FieldValue.delete(),
            heldUntil: FieldValue.delete(),
            bookingId: FieldValue.delete(),
            updatedAt: serverTime(),
          });
        }
      }).catch(() => {});
    }
    // deepcode ignore Sqli: Firestore equality filter on the server-written booking id, not SQL.
    const mail = await db.collection("mail").where("bookingId", "==", doc.id).get();
    await Promise.all(mail.docs.filter((m) => m.data().status !== "sent").map((m) => m.ref.delete()));
    await doc.ref.delete().catch(() => {});
    for (const ref of [...(b.txRefs || []), ...(b.feeTxRefs || [])]) {
      await db.collection("paymentRefs").doc(ref).delete().catch(() => {});
    }
  }

  // 4. Prescriptions (they'd be deleted after 7 days anyway).
  // deepcode ignore Sqli: Firestore equality filter on the account's own uid (from Auth), not SQL.
  const rxs = await db.collection("prescriptions").where("patientUid", "==", uid).get();
  for (const rx of rxs.docs) {
    await rx.ref.delete().catch(() => {});
    await db.collection("prescriptionSignatures").doc(rx.id).delete().catch(() => {});
    summary.prescriptions += 1;
  }

  // 5. The profile.
  // deepcode ignore Sqli: Firestore document ID, not SQL; the account's own uid (from Auth).
  await db.collection("users").doc(uid).delete().catch(() => {});

  await audit(null, {
    actorId: actor.uid,
    actorRole: actor.role,
    action: "Deleted a patient account and their bookings",
    code: "account.deleted",
    category: "account",
    targetType: "user",
    targetId: uid,
    patientUid: uid,
    details: summary,
    meta,
  });
  return summary;
}

const SWEEP_PAGE = 500;

/**
 * A patient's account deleted in the Firebase console: found here (2nd-gen
 * functions have no Auth "deleted" event, and 1st-gen ones don't run on
 * Node 24) and cleaned up like an admin's delete. Run once a day by
 * maintenance.js cleanupRateLimits, so it adds no scheduled job (no cost).
 * Reads each patient profile once, a page at a time; Auth lookups 100 at a
 * time. Resolves how many were cleaned up.
 */
async function sweepDeletedPatients() {
  const { getAuth } = require("firebase-admin/auth");
  let last = null;
  let purged = 0;
  for (;;) {
    let q = db.collection("users").orderBy("__name__").limit(SWEEP_PAGE);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) break;
    for (let i = 0; i < page.docs.length; i += 100) {
      const ids = page.docs.slice(i, i + 100).map((d) => ({ uid: d.id }));
      const { notFound } = await getAuth().getUsers(ids);
      for (const gone of notFound) {
        try {
          await purgePatientData(gone.uid, { actor: { uid: "system", role: "system" } });
          purged += 1;
        } catch (err) {
          logger.error("Clean-up after a deleted patient account failed", { uid: gone.uid, err: err.message });
        }
      }
    }
    if (page.size < SWEEP_PAGE) break;
    last = page.docs[page.docs.length - 1];
  }
  return purged;
}

module.exports = { purgePatientData, sweepDeletedPatients };
