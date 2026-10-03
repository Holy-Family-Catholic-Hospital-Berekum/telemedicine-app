// functions/payments.js
//
// Booking and Paystack payment.
//
//   createBookingDraft  (callable)  patient starts a booking; unpaid
//   initializePayment   (callable)  mints a one-use reference per attempt
//   paystackWebhook     (HTTP)      Paystack reports a completed charge
//   getBookingStatus    (callable)  the page asks "am I paid yet?"
//
// The browser never sends an amount and never marks anything paid. The fee
// comes from loadPrices() (siteSettings/public, falling back to
// DEFAULT_FEES). A payment counts only when Paystack's own verify endpoint,
// reached with the secret key, reports success for a reference we minted
// for this booking, in GHS, for at least the expected amount. Either the
// signed webhook (push) or getBookingStatus (pull) can confirm it, and the
// confirmation is idempotent.
//
// Amounts are whole GHS everywhere. The x100 conversion to pesewas happens
// only in paymentIsAcceptable() here and when the client opens the popup.
//
// Secret (never committed):
//   firebase functions:secrets:set PAYSTACK_SECRET_KEY
// Use the test secret key until go-live, then set the live key.

const crypto = require("crypto");
const { onCall, onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const {
  db,
  FieldValue,
  Timestamp,
  serverTime,
  TYPES,
  MODES,
  SEXES,
  HttpsError,
  requireRole,
  requireVerifiedEmail,
  requestMeta,
  str,
  oneOf,
  docId,
  dateOfBirth,
  phoneE164,
  randomCode,
  sha256,
  audit,
  rateLimit,
} = require("./lib/core");
const { loadPrices } = require("./siteSettings");
const {
  BOOKING_CONSENT_TEXT,
  CURRENT_BOOKING_CONSENT,
} = require("./lib/consentText");

const PAYSTACK_SECRET_KEY = defineSecret("PAYSTACK_SECRET_KEY");
const PAYSTACK_API = "https://api.paystack.co";
const CURRENCY = "GHS";

// References are minted by initializePayment: HFH-<6 code chars>-<bookingId>.
// Anything else is never used as a document ID.
const REFERENCE_RE = /^HFH-[2-9A-Z]{6}-[A-Za-z0-9_-]{1,128}$/;
const isOurReference = (ref) => typeof ref === "string" && REFERENCE_RE.test(ref);

const MAX_OPEN_DRAFTS = 3;
const SLOT_HOLD_MINUTES = 30;
// Unpaid drafts (and their personal details) are deleted after this.
const DRAFT_LIFETIME_HOURS = 24;

/* ------------------------------------------------------------------ */
/* Paystack helpers                                                    */
/* ------------------------------------------------------------------ */

async function verifyPaystackTransaction(reference, secretKey) {
  const res = await fetch(
    `${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${secretKey}` } },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Paystack verify ${res.status}`);
  }
  return body?.data || null;
}

/**
 * The gate. Paystack must report success, in our currency, for at least
 * the amount we expected, on a reference we minted for this booking.
 */
function paymentIsAcceptable(paystackData, booking) {
  if (!paystackData) return false;
  if (paystackData.status !== "success") return false;
  if (paystackData.currency !== booking.currency) return false;
  const expectedPesewas = Math.round(Number(booking.amount) * 100);
  if (!(Number(paystackData.amount) >= expectedPesewas)) return false;
  if (!Array.isArray(booking.txRefs) || !booking.txRefs.includes(paystackData.reference)) {
    return false;
  }
  return true;
}

/**
 * Flip a booking to paid, exactly once. Paystack retries webhooks and the
 * page polls at the same time, so this can run twice for one payment: the
 * transaction re-reads status and bails if it has already moved on.
 */
async function markBookingPaid(bookingRef, paystackData, via) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists) return { changed: false, status: "missing" };

    const booking = snap.data();
    if (booking.status !== "awaiting_payment") {
      return { changed: false, status: booking.status };
    }
    if (!paymentIsAcceptable(paystackData, booking)) {
      return { changed: false, status: "rejected" };
    }

    // Reads before writes: the claimed slot, if any.
    let slotRef = null;
    let slotOk = false;
    if (booking.slotId) {
      slotRef = db.collection("availableSlots").doc(booking.slotId);
      const slotSnap = await tx.get(slotRef);
      const slot = slotSnap.exists ? slotSnap.data() : null;
      slotOk =
        !!slot &&
        (slot.bookingId === bookingRef.id || slot.status === "open") &&
        slot.status !== "cancelled" &&
        slot.status !== "booked";
    }

    const amountPaid = Number(paystackData.amount) / 100; // pesewas -> GHS

    tx.update(bookingRef, {
      status: "paid",
      paidAt: serverTime(),
      paystackTransactionId: String(paystackData.id),
      paystackReference: paystackData.reference,
      amountPaid,
      paymentChannel: paystackData.channel || null,
      verifiedVia: via,
      expiresAt: FieldValue.delete(),
      slotLost: booking.slotId ? !slotOk : FieldValue.delete(),
      updatedAt: serverTime(),
    });

    if (slotRef && slotOk) {
      tx.update(slotRef, {
        status: "booked",
        bookingId: bookingRef.id,
        heldUntil: FieldValue.delete(),
        updatedAt: serverTime(),
      });
    }

    // Revenue record. Survives the booking (which is deleted when the
    // consultation closes) and carries no personal details.
    tx.set(db.collection("confirmedPayments").doc(paystackData.reference), {
      amount: amountPaid,
      type: booking.type,
      mode: booking.mode,
      channel: paystackData.channel || null,
      reference: paystackData.reference,
      paidAt: serverTime(),
    });

    audit(tx, {
      actorId: "system",
      action: "Payment confirmed",
      code: "payment.confirmed",
      category: "payment",
      targetType: "booking",
      targetId: bookingRef.id,
      patientUid: booking.patientUid,
      details: { via, reference: paystackData.reference },
    });

    return { changed: true, status: "paid" };
  });
}

/* ------------------------------------------------------------------ */
/* createBookingDraft                                                  */
/* ------------------------------------------------------------------ */

/**
 * data: { type, mode, dateOfBirth, sex, town, area, phone,
 *         doctorUid?, slotId?, consentVersion }
 */
exports.createBookingDraft = onCall(async (request) => {
  const caller = await requireRole(request, ["patient"]);
  requireVerifiedEmail(caller);
  const uid = caller.uid;
  const d = request.data || {};

  let type = oneOf(d.type, TYPES, "consultation type");
  let mode = oneOf(d.mode, MODES, "consultation mode");
  const dob = dateOfBirth(d.dateOfBirth);
  const sex = oneOf(d.sex, SEXES, "sex");
  const town = str(d.town, { field: "Town", max: 80 });
  const area = str(d.area, { field: "Area", max: 120 });
  const phone = phoneE164(d.phone);
  const slotId = d.slotId ? docId(d.slotId, "Slot") : null;
  let doctorUid = d.doctorUid ? docId(d.doctorUid, "Doctor") : null;

  if (d.consentVersion !== CURRENT_BOOKING_CONSENT) {
    throw new HttpsError(
      "failed-precondition",
      "The consent wording has changed. Please reload the page and review it.",
    );
  }

  await rateLimit(uid, "createBookingDraft", { max: 10, windowSeconds: 86400 });

  const openDrafts = await db
    .collection("bookings")
    .where("patientUid", "==", uid)
    .where("status", "==", "awaiting_payment")
    .count()
    .get();
  if (openDrafts.data().count >= MAX_OPEN_DRAFTS) {
    throw new HttpsError(
      "resource-exhausted",
      "You already have unpaid bookings. Finish or wait for those to expire first.",
    );
  }

  const prices = await loadPrices();
  let amount = prices[type];
  const meta = requestMeta(request);
  const bookingRef = db.collection("bookings").doc();
  const consentRef = db.collection("consents").doc();
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    // --- reads ---
    let slot = null;
    let slotRef = null;
    if (slotId) {
      slotRef = db.collection("availableSlots").doc(slotId);
      const slotSnap = await tx.get(slotRef);
      slot = slotSnap.exists ? slotSnap.data() : null;
      const heldExpired =
        slot?.status === "held" && (slot.heldUntil?.toMillis?.() ?? 0) < now;
      if (!slot || !(slot.status === "open" || heldExpired)) {
        throw new HttpsError(
          "failed-precondition",
          "That slot is no longer available. Please choose another.",
        );
      }
      if ((slot.startAt?.toMillis?.() ?? 0) < now) {
        throw new HttpsError("failed-precondition", "That slot has already passed.");
      }
      // The slot decides the doctor, type and mode.
      doctorUid = slot.doctorUid;
      type = slot.type;
      mode = slot.mode;
      amount = prices[type];
    }

    let doctorName = null;
    if (doctorUid) {
      const docSnap = await tx.get(db.collection("doctorProfiles").doc(doctorUid));
      const profile = docSnap.exists ? docSnap.data() : null;
      if (
        !profile ||
        profile.isListed !== true ||
        !Array.isArray(profile.availableFor) ||
        !profile.availableFor.includes(type)
      ) {
        throw new HttpsError(
          "failed-precondition",
          "That doctor isn't available for this consultation type.",
        );
      }
      doctorName = profile.name || null;
    }

    // --- writes ---
    if (slotRef) {
      tx.update(slotRef, {
        status: "held",
        heldByUid: uid,
        bookingId: bookingRef.id,
        heldUntil: Timestamp.fromMillis(now + SLOT_HOLD_MINUTES * 60 * 1000),
        updatedAt: serverTime(),
      });
    }

    tx.set(consentRef, {
      subjectUid: uid,
      consentType: "booking_data_and_recording",
      action: "granted",
      context: "booking",
      version: CURRENT_BOOKING_CONSENT,
      textSha256: sha256(BOOKING_CONSENT_TEXT[CURRENT_BOOKING_CONSENT]),
      bookingId: bookingRef.id,
      at: serverTime(),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    tx.set(bookingRef, {
      patientUid: uid,
      patientName: caller.profile.name || null,
      email: caller.token.email || null,
      type,
      mode,
      // Personal details: deleted with the booking when it closes.
      dateOfBirth: dob,
      sex,
      location: `${area}, ${town}`,
      phone,
      requestedDoctorUid: doctorUid,
      requestedDoctorName: doctorName,
      slotId,
      preferredTime: slot?.startAt || null,
      amount, // whole GHS
      currency: CURRENCY,
      status: "awaiting_payment",
      txRefs: [],
      consentId: consentRef.id,
      createdAt: serverTime(),
      updatedAt: serverTime(),
      expiresAt: Timestamp.fromMillis(now + DRAFT_LIFETIME_HOURS * 3600 * 1000),
    });

    audit(tx, {
      actorId: uid,
      actorRole: "patient",
      action: "Started a booking",
      code: "booking.created",
      category: "booking",
      targetType: "booking",
      targetId: bookingRef.id,
      patientUid: uid,
      meta,
    });
  });

  return { bookingId: bookingRef.id, amount, currency: CURRENCY, type, mode };
});

/* ------------------------------------------------------------------ */
/* initializePayment                                                   */
/* ------------------------------------------------------------------ */

/**
 * A fresh reference for every attempt, so a failed attempt's reference
 * can never be reused to claim a later success.
 */
exports.initializePayment = onCall(async (request) => {
  const caller = await requireRole(request, ["patient"]);
  requireVerifiedEmail(caller);
  const bookingId = docId(request.data?.bookingId, "Booking");

  await rateLimit(caller.uid, "initializePayment", { max: 20, windowSeconds: 3600 });

  const ref = db.collection("bookings").doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().patientUid !== caller.uid) {
    throw new HttpsError("not-found", "Booking not found.");
  }
  const booking = snap.data();
  if (booking.status !== "awaiting_payment") {
    throw new HttpsError("failed-precondition", "This booking has already been paid for.");
  }
  if (booking.txRefs.length >= 10) {
    throw new HttpsError(
      "resource-exhausted",
      "Too many payment attempts on this booking. Please start a new booking.",
    );
  }

  const reference = `HFH-${randomCode(6)}-${bookingId}`;
  const batch = db.batch();
  batch.update(ref, {
    txRefs: FieldValue.arrayUnion(reference),
    lastTxRef: reference,
    lastAttemptAt: serverTime(),
  });
  // Reverse lookup for the webhook. Deleted with the booking.
  batch.set(db.collection("paymentRefs").doc(reference), {
    bookingId,
    patientUid: caller.uid,
    createdAt: serverTime(),
  });
  await batch.commit();

  return {
    reference,
    amount: booking.amount, // whole GHS; the client multiplies by 100
    currency: booking.currency,
    customer: {
      name: booking.patientName || "",
      email: booking.email || "",
      phone: booking.phone,
    },
  };
});

/* ------------------------------------------------------------------ */
/* paystackWebhook                                                     */
/* ------------------------------------------------------------------ */

function signatureMatches(rawBody, header, secret) {
  if (typeof header !== "string" || !rawBody) return false;
  const expected = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(header, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.paystackWebhook = onRequest(
  { secrets: [PAYSTACK_SECRET_KEY], cors: false },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }
    if (!signatureMatches(req.rawBody, req.headers["x-paystack-signature"], PAYSTACK_SECRET_KEY.value())) {
      logger.warn("Rejected webhook with bad or missing signature");
      await audit(null, {
        action: "Rejected a payment webhook with a bad signature",
        code: "webhook.signature_invalid",
        category: "security",
        result: "denied",
      }).catch(() => {});
      res.status(401).send("Invalid signature");
      return;
    }

    const event = req.body || {};
    if (event.event !== "charge.success" || !isOurReference(event.data?.reference)) {
      res.status(200).send("Ignored");
      return;
    }

    try {
      // Don't trust the body's numbers: ask Paystack.
      const tx = await verifyPaystackTransaction(event.data.reference, PAYSTACK_SECRET_KEY.value());
      if (!isOurReference(tx?.reference) || tx.reference !== event.data.reference) {
        res.status(200).send("No reference");
        return;
      }

      const refSnap = await db.collection("paymentRefs").doc(tx.reference).get();
      if (!refSnap.exists) {
        // A real payment we can't attach to a booking (e.g. paid after
        // the draft expired). Flag it so finance can refund.
        logger.error("Payment for unknown or expired reference", { reference: tx.reference });
        await audit(null, {
          action: "Payment received for an expired or unknown booking — refund needed",
          code: "payment.flagged",
          category: "payment",
          result: "failed",
          targetType: "payment",
          targetId: tx.reference,
          details: { amount: Number(tx.amount) / 100, currency: tx.currency },
        });
        res.status(200).send("Unknown reference");
        return;
      }

      const bookingRef = db.collection("bookings").doc(refSnap.data().bookingId);
      const result = await markBookingPaid(bookingRef, tx, "webhook");
      if (result.status === "rejected") {
        await audit(null, {
          action: "Payment didn't match its booking — check before confirming",
          code: "payment.flagged",
          category: "payment",
          result: "failed",
          targetType: "booking",
          targetId: bookingRef.id,
          details: { reference: tx.reference },
        });
      }
      res.status(200).send("OK");
    } catch (err) {
      logger.error("Webhook processing failed", err);
      // 500 so Paystack retries.
      res.status(500).send("Error");
    }
  },
);

/* ------------------------------------------------------------------ */
/* getBookingStatus                                                    */
/* ------------------------------------------------------------------ */

exports.getBookingStatus = onCall(
  { secrets: [PAYSTACK_SECRET_KEY] },
  async (request) => {
    const caller = await requireRole(request, ["patient"]);
    const bookingId = docId(request.data?.bookingId, "Booking");

    await rateLimit(caller.uid, "getBookingStatus", { max: 120, windowSeconds: 3600 });

    const ref = db.collection("bookings").doc(bookingId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().patientUid !== caller.uid) {
      throw new HttpsError("not-found", "Booking not found.");
    }
    const booking = snap.data();
    if (booking.status !== "awaiting_payment") return { status: "confirmed" };
    if (!booking.lastTxRef) return { status: "pending" };

    let tx;
    try {
      tx = await verifyPaystackTransaction(booking.lastTxRef, PAYSTACK_SECRET_KEY.value());
    } catch (err) {
      // No transaction yet is normal seconds after paying.
      logger.debug("verify not ready", { bookingId, error: err.message });
      return { status: "pending" };
    }

    if (tx?.status === "success") {
      const result = await markBookingPaid(ref, tx, "verify_api");
      if (result.status === "paid") return { status: "confirmed" };
      logger.warn("Successful payment failed our checks", { bookingId });
      await audit(null, {
        action: "Payment didn't match its booking — check before confirming",
        code: "payment.flagged",
        category: "payment",
        result: "failed",
        targetType: "booking",
        targetId: bookingId,
        patientUid: caller.uid,
      });
      return {
        status: "failed",
        message:
          "We couldn't match your payment to this booking. Please contact the hospital before paying again.",
      };
    }
    if (tx && (tx.status === "failed" || tx.status === "abandoned")) {
      return {
        status: "failed",
        message: "That payment didn't complete, so no booking was made.",
      };
    }
    return { status: "pending" };
  },
);

// Shared with maintenance.js. Not Cloud Functions: index.js only re-exports
// the functions above by name.
exports.markBookingPaid = markBookingPaid;
exports.verifyPaystackTransaction = verifyPaystackTransaction;
exports.PAYSTACK_SECRET_KEY = PAYSTACK_SECRET_KEY;
