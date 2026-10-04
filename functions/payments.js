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
const { loadPrices, doctorSelectionEnabled } = require("./siteSettings");
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

// Trimmed so a stray newline from pasting doesn't break authentication.
const secretKey = () => PAYSTACK_SECRET_KEY.value().trim();

// Paystack statuses for a charge that may still complete (e.g. a MoMo
// prompt waiting on the patient's phone).
const IN_FLIGHT = new Set([
  "ongoing", "pending", "processing", "queued",
  "send_otp", "send_pin", "send_phone", "send_birthday", "send_address", "open_url",
]);
// How long an unfinished attempt blocks a new one.
const IN_FLIGHT_WINDOW_MINUTES = 30;

async function verifyPaystackTransaction(reference, key) {
  const res = await fetch(
    `${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(`Paystack verify ${res.status}`);
    err.status = res.status;
    if (res.status === 401) {
      // Wrong or missing secret key: every payment would stay "pending".
      logger.error("Paystack rejected the secret key (401). Check PAYSTACK_SECRET_KEY.");
    }
    throw err;
  }
  return body?.data || null;
}

/**
 * Money Paystack took that we can't apply to a booking (duplicate attempt,
 * late payment after the booking was removed, or amount mismatch). Listed
 * for admins as "refund due" and audited. Idempotent per reference.
 */
async function recordPaymentIssue(paystackData, { reason, bookingId = null, patientUid = null }) {
  const ref = db.collection("paymentIssues").doc(paystackData.reference);
  const created = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return false;
    tx.set(ref, {
      reference: paystackData.reference,
      bookingId,
      patientUid,
      amount: Number(paystackData.amount) / 100,
      currency: paystackData.currency || CURRENCY,
      channel: paystackData.channel || null,
      reason,
      status: "refund_due",
      createdAt: serverTime(),
    });
    audit(tx, {
      action: `Payment needs a refund (${reason.replace(/_/g, " ")})`,
      code: "payment.flagged",
      category: "payment",
      result: "failed",
      targetType: "payment",
      targetId: paystackData.reference,
      patientUid,
      details: { bookingId, reason },
    });
    return true;
  });
  if (created) logger.warn("Payment flagged for refund", { reference: paystackData.reference, reason });
}

/**
 * Asks Paystack about EVERY payment attempt on an unpaid booking, newest
 * first (an older attempt can complete after a newer one was abandoned):
 *   "paid"      an attempt succeeded; the booking is now confirmed
 *   "rejected"  an attempt succeeded but didn't match (flagged for refund)
 *   "in_flight" an attempt may still complete; don't start another
 *   "unknown"   Paystack couldn't be asked; treat as possibly in flight
 *   "failed"    the latest attempt failed or was abandoned
 *   "none"      no attempt has started
 */
async function checkAttempts(bookingRef, booking, { strict = false } = {}) {
  const refs = Array.isArray(booking.txRefs) ? [...booking.txRefs].reverse() : [];
  if (booking.status !== "awaiting_payment") return "paid";
  if (refs.length === 0) return "none";

  let inFlight = false;
  let unknown = false;
  let latestStatus = null;
  for (const [i, reference] of refs.entries()) {
    let tx;
    try {
      tx = await verifyPaystackTransaction(reference, secretKey());
    } catch (err) {
      if (err.status === 404 || err.status === 400) continue; // never started
      unknown = true;
      continue;
    }
    if (i === 0) latestStatus = tx?.status || null;
    if (tx?.status === "success") {
      const result = await markBookingPaid(bookingRef, tx, "verify_api");
      if (result.status === "paid") return "paid";
      if (result.status === "rejected") {
        await recordPaymentIssue(tx, {
          reason: "amount_mismatch",
          bookingId: bookingRef.id,
          patientUid: booking.patientUid,
        });
        return "rejected";
      }
      if (result.duplicate) {
        await recordPaymentIssue(tx, {
          reason: "duplicate_payment",
          bookingId: bookingRef.id,
          patientUid: booking.patientUid,
        });
      }
      return "paid"; // already paid by another attempt
    }
    const createdAt = Date.parse(tx?.created_at || tx?.createdAt || "");
    const recent =
      Number.isFinite(createdAt) &&
      Date.now() - createdAt < IN_FLIGHT_WINDOW_MINUTES * 60 * 1000;
    if (IN_FLIGHT.has(tx?.status) && recent) inFlight = true;
    // Strict (used before a NEW booking): a recently closed checkout may
    // still have a mobile-money prompt waiting on the phone, so anything
    // short of a definite failure counts as unconfirmed.
    if (strict && recent && tx?.status !== "failed" && tx?.status !== "reversed") inFlight = true;
  }
  if (inFlight) return "in_flight";
  if (unknown) return "unknown";
  if (latestStatus === "failed" || latestStatus === "abandoned" || latestStatus === "reversed") {
    return "failed";
  }
  return "none";
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
      // A second successful attempt on a booking that's already paid is a
      // double charge: report it so the caller can flag it for refund.
      const duplicate =
        paystackData?.status === "success" &&
        paystackData.reference !== booking.paystackReference &&
        Array.isArray(booking.txRefs) &&
        booking.txRefs.includes(paystackData.reference);
      return { changed: false, status: booking.status, duplicate, booking };
    }
    if (!paymentIsAcceptable(paystackData, booking)) {
      return { changed: false, status: "rejected", booking };
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
exports.createBookingDraft = onCall({ secrets: [PAYSTACK_SECRET_KEY] }, async (request) => {
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

  // Never let a patient pay for a second booking while an earlier payment
  // might still go through: that's how double payments happen.
  const drafts = await db
    .collection("bookings")
    .where("patientUid", "==", uid)
    .where("status", "==", "awaiting_payment")
    .get();
  for (const draft of drafts.docs) {
    const state = await checkAttempts(draft.ref, draft.data(), { strict: true });
    if (state === "paid") {
      throw new HttpsError(
        "failed-precondition",
        "A payment you made earlier has just been confirmed. Check your dashboard before booking again.",
      );
    }
    if (state === "in_flight" || state === "unknown") {
      throw new HttpsError(
        "failed-precondition",
        "You have a payment that hasn't been confirmed yet. You can't start another booking until it is confirmed or has clearly failed. Approve or decline the prompt on your phone, then use \"Check payment\" on your dashboard.",
      );
    }
  }
  if (drafts.size >= MAX_OPEN_DRAFTS) {
    throw new HttpsError(
      "resource-exhausted",
      "You already have unpaid bookings. Finish or wait for those to expire first.",
    );
  }

  // Admin switch: when doctor choice is off, ignore any doctor sent
  // (an admin-created slot still decides its own doctor below).
  if (doctorUid && !slotId && !(await doctorSelectionEnabled())) {
    doctorUid = null;
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
exports.initializePayment = onCall({ secrets: [PAYSTACK_SECRET_KEY] }, async (request) => {
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
  // Don't open a second charge while the previous one may still complete.
  const last = await checkAttempts(ref, booking);
  if (last === "paid") return { status: "confirmed" };
  if (last === "rejected") {
    throw new HttpsError(
      "failed-precondition",
      "We couldn't match your earlier payment to this booking. Please contact the hospital before paying again.",
    );
  }
  if (last === "in_flight" || last === "unknown") {
    throw new HttpsError(
      "failed-precondition",
      "Your last payment attempt is still being processed. Approve or decline the prompt on your phone, then wait a minute before trying again.",
    );
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
    if (!signatureMatches(req.rawBody, req.headers["x-paystack-signature"], secretKey())) {
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
      const tx = await verifyPaystackTransaction(event.data.reference, secretKey());
      if (!isOurReference(tx?.reference) || tx.reference !== event.data.reference) {
        res.status(200).send("No reference");
        return;
      }

      const refSnap = await db.collection("paymentRefs").doc(tx.reference).get();
      if (!refSnap.exists) {
        // A real payment we can't attach to a booking (e.g. paid after
        // the draft expired). Flag it so finance can refund.
        if (tx.status === "success") {
          await recordPaymentIssue(tx, { reason: "no_matching_booking" });
        }
        res.status(200).send("Unknown reference");
        return;
      }

      const bookingRef = db.collection("bookings").doc(refSnap.data().bookingId);
      const result = await markBookingPaid(bookingRef, tx, "webhook");
      const ids = { bookingId: bookingRef.id, patientUid: refSnap.data().patientUid };
      if (result.status === "rejected") {
        await recordPaymentIssue(tx, { reason: "amount_mismatch", ...ids });
      } else if (result.duplicate) {
        await recordPaymentIssue(tx, { reason: "duplicate_payment", ...ids });
      } else if (result.status === "missing" && tx.status === "success") {
        await recordPaymentIssue(tx, { reason: "no_matching_booking", ...ids });
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
    const state = await checkAttempts(ref, snap.data());
    if (state === "paid") return { status: "confirmed" };
    if (state === "rejected") {
      return {
        status: "failed",
        message:
          "We couldn't match your payment to this booking. Please contact the hospital before paying again.",
      };
    }
    if (state === "failed") {
      return {
        status: "failed",
        message: "That payment didn't complete, so no booking was made.",
      };
    }
    // none / in_flight / unknown: keep waiting.
    return { status: "pending" };
  },
);

/* ------------------------------------------------------------------ */
/* resolvePaymentIssue                                                 */
/* ------------------------------------------------------------------ */

/**
 * data: { reference, note }
 * Admin records that a flagged payment was refunded (through the Paystack
 * dashboard: Transactions -> the reference -> Refund). Audited.
 */
exports.resolvePaymentIssue = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const reference = str(request.data?.reference, { field: "Reference", max: 160 });
  if (!isOurReference(reference)) {
    throw new HttpsError("invalid-argument", "That reference isn't valid.");
  }
  const note = str(request.data?.note, { field: "Note", max: 300, min: 3 });
  const ref = db.collection("paymentIssues").doc(reference);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Payment issue not found.");
    if (snap.data().status !== "refund_due") {
      throw new HttpsError("failed-precondition", "This one is already resolved.");
    }
    tx.update(ref, {
      status: "refunded",
      resolvedByUid: caller.uid,
      resolvedAt: serverTime(),
      note,
    });
    audit(tx, {
      actorId: caller.uid,
      actorRole: "admin",
      action: "Marked a payment as refunded",
      code: "payment.refunded",
      category: "payment",
      targetType: "payment",
      targetId: reference,
      patientUid: snap.data().patientUid || null,
      reason: note,
      meta: requestMeta(request),
    });
  });
  return { ok: true };
});

// Shared with maintenance.js. Not Cloud Functions: index.js only re-exports
// the functions above by name.
exports.markBookingPaid = markBookingPaid;
exports.recordPaymentIssue = recordPaymentIssue;
exports.checkAttempts = checkAttempts;
exports.secretKey = secretKey;
exports.verifyPaystackTransaction = verifyPaystackTransaction;
exports.PAYSTACK_SECRET_KEY = PAYSTACK_SECRET_KEY;
