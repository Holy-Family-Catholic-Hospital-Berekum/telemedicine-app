/**
 * functions/index.js
 * Payment backend for the consultation booking flow — Paystack edition.
 *
 * ── THE SECURITY MODEL IN ONE PARAGRAPH ──────────────────────────────
 * The browser is treated as hostile. It can ask to create a draft and it
 * can ask what a booking's status is — that's all. It cannot set the
 * fee, cannot mark anything paid, and is never told anything it could
 * use to move money. The fee comes from CONSULTATION_FEES/loadPrices()
 * below, on the server. Confirmation comes from Paystack's own API,
 * reached with a secret key that exists only here. Firestore rules (see
 * firestore.rules) stop the client writing booking status directly, and
 * these functions use the Admin SDK, which bypasses those rules — so the
 * only path to "paid" runs through code you control.
 *
 * ── THE FOUR FUNCTIONS ───────────────────────────────────────────────
 * createBookingDraft  (callable)  patient starts a booking; unpaid
 * initializePayment   (callable)  mints a one-use reference for an attempt
 * paystackWebhook      (HTTP)      Paystack tells us money arrived
 * getBookingStatus    (callable)  patient's page asks "am I paid yet?"
 *
 * Two independent things can confirm a payment: the webhook (push) and
 * getBookingStatus's verify-by-reference (pull). Either alone is enough.
 * Having both means a missed webhook doesn't strand a paying patient,
 * and a patient who closes the tab still gets their booking.
 *
 * ── REVENUE RECORD (confirmedPayments) ────────────────────────────────
 * `bookings` docs are deleted once a consultation is marked done (4.6
 * erasure) — which would otherwise take every trace of a payment with
 * it. So the moment a payment is confirmed (inside markBookingPaid,
 * below), we also write a small, permanent record to
 * `confirmedPayments`, used only by the admin Revenue tab. That record
 * is revenue reporting, not a clinical or identifying record: no
 * dateOfBirth, sex, location, phone, or patient uid — only amount,
 * type, mode, channel, reference and paidAt. Revenue here means "money
 * Paystack confirmed," not "money for a consultation that actually
 * happened" — a paid booking that's later cancelled or never attended
 * still counts. If the hospital instead wants revenue to reflect only
 * completed consultations, this write should move to whichever
 * function performs the 4.6 erasure, carrying these same fields
 * forward from the booking before it's deleted.
 *
 * ── MIGRATION NOTE (Flutterwave → Paystack) ──────────────────────────
 * Two things bite people doing this exact migration, so both get called
 * out again at the point they matter below:
 *   1. Paystack amounts are in the SMALLEST currency unit (pesewas for
 *      GHS), not whole cedis. Firestore/this file store `amount` in
 *      whole GHS throughout — the ×100 conversion happens at exactly
 *      one point, in paymentIsAcceptable() below, and nowhere else on
 *      the server. The client does its own ×100 when opening the
 *      Paystack popup — see bookConsultation.jsx.
 *   2. Paystack's webhook signature is an HMAC-SHA512 of the raw
 *      request body, keyed with your SECRET key directly — there's no
 *      separate invented "hash" to configure like Flutterwave's
 *      verif-hash. One secret does both jobs now.
 *
 * ── SECRETS ──────────────────────────────────────────────────────────
 * Set this once, it is never committed to git:
 *   firebase functions:secrets:set PAYSTACK_SECRET_KEY
 * That's the only payment secret needed — see the migration note above.
 *
 * Requires Node 20+ and the Blaze plan (Cloud Functions can't make
 * outbound calls to Paystack on the free Spark plan).
 */

const {
  onCall,
  onRequest,
  HttpsError,
} = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
require("./siteSettings"); // registers updateConsultationPrices, updateSiteImages
const { loadPrices } = require("./siteSettings");

const db = admin.firestore();

// Keep this in step with FUNCTIONS_REGION in bookConsultation.jsx.
setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

const PAYSTACK_SECRET_KEY = defineSecret("PAYSTACK_TEST_SECRET_KEY");

const PAYSTACK_API = "https://api.paystack.co";

// The only authoritative fee table. Never accept an amount from a client.
// Amounts here are in whole GHS — the same unit used everywhere in this
// file and in Firestore. Only paymentIsAcceptable() below ever converts
// to pesewas, to compare against what Paystack reports.
const CONSULTATION_FEES = {
  OPD: 250,
  SURGICAL: 300,
};
const CURRENCY = "GHS";

const VALID_TYPES = Object.keys(CONSULTATION_FEES);
const VALID_MODES = ["online", "offline"];
const VALID_SEXES = ["female", "male"];

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Please sign in to continue.");
  }
  // Booking is gated on a verified email per the architecture.
  if (request.auth.token.email_verified === false) {
    throw new HttpsError(
      "permission-denied",
      "Please verify your email address before booking.",
    );
  }
  return request.auth;
}

function cleanString(value, { max = 120, field }) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpsError("invalid-argument", `${field} is required.`);
  }
  return value.trim().slice(0, max);
}

/**
 * Ghana MSISDN, loosely normalised to 233XXXXXXXXX. Loose on purpose:
 * rejecting a real patient's number is worse than passing a slightly odd
 * one to Paystack, which does its own validation at the popup.
 */
function normalisePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 9) {
    throw new HttpsError("invalid-argument", "Enter a valid phone number.");
  }
  if (digits.startsWith("233")) return digits;
  if (digits.startsWith("0")) return "233" + digits.slice(1);
  return digits;
}

/** Server-to-server call to Paystack. The secret key never leaves here. */
async function paystackGet(path, secretKey) {
  const res = await fetch(`${PAYSTACK_API}${path}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `Paystack ${res.status}: ${body ? JSON.stringify(body).slice(0, 300) : "no body"}`,
    );
  }
  return body;
}

/**
 * Verifies one transaction by reference. Paystack uses this single
 * endpoint for both "I have a reference, tell me what happened" cases —
 * unlike Flutterwave, which needed a numeric transaction id for the
 * webhook path and a separate query-param endpoint for polling. That
 * meant two lookup shapes there; here it's one function, used by both
 * the webhook handler and getBookingStatus below.
 */
async function verifyPaystackTransaction(reference, secretKey) {
  const body = await paystackGet(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    secretKey,
  );
  return body?.data || null;
}

/**
 * The gate. Given what Paystack reports about a transaction and what we
 * expected, decide whether this counts as paid.
 *
 * Checking the amount and currency here is not paranoia: someone could
 * in principle tamper with a client-side amount before a charge starts.
 * Without this check, someone could pay GHS 1 for a GHS 250
 * consultation. We compare against our own record instead.
 *
 * MIGRATION NOTE: this is the one place the ×100 pesewas conversion
 * happens on the server. `booking.amount` is whole GHS everywhere else
 * in this file; `paystackData.amount` is pesewas, straight from
 * Paystack. Do the conversion here, not by changing what's stored.
 */
function paymentIsAcceptable(paystackData, booking) {
  if (!paystackData) return false;
  if (paystackData.status !== "success") return false;
  if (paystackData.currency !== booking.currency) return false;
  const expectedPesewas = Math.round(Number(booking.amount) * 100);
  // Paystack's amount can exceed what we asked for if the customer covers
  // transaction fees; it should never be less.
  if (Number(paystackData.amount) < expectedPesewas) return false;
  // The reference must be one we minted for THIS booking.
  if (!booking.txRefs || !booking.txRefs.includes(paystackData.reference)) {
    return false;
  }
  return true;
}

/**
 * Flip a booking to paid, exactly once.
 *
 * Idempotency matters here. Paystack retries webhooks, and the patient's
 * page may be polling at the same moment, so this can run twice for one
 * payment. The transaction re-reads status inside the lock and bails if
 * it's already paid, so a double delivery can't create a second booking,
 * a second notification, or (see below) a second confirmedPayments
 * record.
 */
async function markBookingPaid(bookingRef, paystackData) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists) return { changed: false, status: "failed" };

    const booking = snap.data();
    if (booking.status === "paid") return { changed: false, status: "paid" };

    if (!paymentIsAcceptable(paystackData, booking)) {
      return { changed: false, status: booking.status };
    }

    const amountPaid = Number(paystackData.amount) / 100; // pesewas -> whole GHS

    tx.update(bookingRef, {
      status: "paid",
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      paystackTransactionId: String(paystackData.id),
      paystackReference: paystackData.reference,
      // Stored back in whole GHS, matching booking.amount's unit — see
      // the migration note on paymentIsAcceptable().
      amountPaid,
      paymentChannel: paystackData.channel || null,
    });

    // Revenue reporting needs a record that outlives this booking —
    // `bookings` docs are deleted once the consultation is marked done
    // (4.6 erasure), which would otherwise take every trace of this
    // payment with it. This record intentionally carries NO clinical
    // or identifying fields (no dateOfBirth, sex, location, phone,
    // patient uid) — just what the admin Revenue tab needs to report.
    // The transaction's early-return above (booking.status === "paid")
    // is what keeps a retried webhook/poll from creating a duplicate
    // record here.
    tx.set(db.collection("confirmedPayments").doc(), {
      amount: amountPaid,
      type: booking.type, // "OPD" | "SURGICAL"
      mode: booking.mode, // "online" | "offline"
      channel: paystackData.channel || null,
      reference: paystackData.reference,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { changed: true, status: "paid" };
  });
}

/** What the patient's page is allowed to know. */
function publicStatus(booking) {
  if (!booking) return { status: "failed", message: "Booking not found." };
  if (booking.status === "paid") return { status: "confirmed" };
  if (booking.status === "failed") {
    return {
      status: "failed",
      message: "That payment didn't complete, so no booking was made.",
    };
  }
  return { status: "pending" };
}

/* ------------------------------------------------------------------ */
/* 1. createBookingDraft                                               */
/* ------------------------------------------------------------------ */

/**
 * Creates an unpaid draft. Note what the client does NOT send: an amount.
 * It sends the choices, and the fee is looked up here.
 */
exports.createBookingDraft = onCall(async (request) => {
  const auth = requireAuth(request);
  const d = request.data || {};

  if (!VALID_TYPES.includes(d.type)) {
    throw new HttpsError("invalid-argument", "Choose a consultation type.");
  }
  if (!VALID_MODES.includes(d.mode)) {
    throw new HttpsError("invalid-argument", "Choose a consultation mode.");
  }
  if (!VALID_SEXES.includes(d.sex)) {
    throw new HttpsError("invalid-argument", "Select your sex.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.dateOfBirth || "")) {
    throw new HttpsError("invalid-argument", "Enter a valid date of birth.");
  }

  const prices = await loadPrices();
  const amount = prices[d.type];
  const ref = db.collection("bookings").doc();

  await ref.set({
    uid: auth.uid,
    email: auth.token.email || null,
    type: d.type,
    mode: d.mode,
    dateOfBirth: d.dateOfBirth,
    sex: d.sex,
    location: cleanString(d.location, { field: "Location" }),
    phone: normalisePhone(d.phone),
    amount, // whole GHS
    currency: CURRENCY,
    status: "awaiting_payment",
    txRefs: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { bookingId: ref.id, amount, currency: CURRENCY };
});

/* ------------------------------------------------------------------ */
/* 2. initializePayment                                                */
/* ------------------------------------------------------------------ */

/**
 * Mints a fresh reference for one payment attempt and records it against
 * the booking. A new reference per attempt is what makes retries safe: a
 * failed attempt's reference can never be reused to claim a later
 * success, and each reference maps to exactly one booking.
 *
 * There's no Paystack API call to make here — with the Inline popup, the
 * transaction is opened client-side with the public key and this
 * reference. The security comes from verification afterwards (see
 * paystackWebhook and getBookingStatus), not from this step.
 */
exports.initializePayment = onCall(async (request) => {
  const auth = requireAuth(request);
  const bookingId = cleanString(request.data?.bookingId, {
    field: "Booking",
    max: 64,
  });

  const ref = db.collection("bookings").doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Booking not found.");

  const booking = snap.data();
  if (booking.uid !== auth.uid) {
    throw new HttpsError("permission-denied", "This isn't your booking.");
  }
  if (booking.status === "paid") {
    throw new HttpsError(
      "failed-precondition",
      "This booking has already been paid for.",
    );
  }

  // Paystack references are typically alphanumeric with no fixed prefix
  // convention — HFH- keeps ours easy to spot in the Paystack dashboard.
  const reference = `HFH-${bookingId}-${Date.now()}`;

  await ref.update({
    txRefs: admin.firestore.FieldValue.arrayUnion(reference),
    lastTxRef: reference,
    lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Reverse lookup so the webhook can find the booking from a reference
  // without scanning the collection.
  await db.collection("paymentRefs").doc(reference).set({
    bookingId,
    uid: auth.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    reference,
    amount: booking.amount, // whole GHS — client multiplies by 100, see bookConsultation.jsx
    currency: booking.currency,
    customer: {
      name: auth.token.name || "",
      email: auth.token.email || "",
      phone: booking.phone,
    },
  };
});

/* ------------------------------------------------------------------ */
/* 3. paystackWebhook                                                  */
/* ------------------------------------------------------------------ */

/**
 * Paystack calls this when a charge completes. Three rules:
 *
 * 1. Verify the sender. x-paystack-signature must equal an HMAC-SHA512
 *    of the raw request body, keyed with our secret key. Without this,
 *    anyone who finds the URL could POST a fake success. This uses
 *    req.rawBody (Cloud Functions gives you this for exactly this
 *    reason) rather than re-stringifying req.body, since re-stringified
 *    JSON isn't guaranteed to byte-for-byte match what Paystack signed.
 * 2. Don't trust the payload's numbers. The body says a payment
 *    succeeded; we call the verify endpoint and believe that instead.
 * 3. Always answer 200 quickly, even for events we ignore. A non-200
 *    makes Paystack retry, and retrying a webhook we deliberately
 *    skipped is just noise.
 */
exports.paystackWebhook = onRequest(
  { secrets: [PAYSTACK_SECRET_KEY], cors: false },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const signature = req.headers["x-paystack-signature"];
    const expectedSignature = crypto
      .createHmac("sha512", PAYSTACK_SECRET_KEY.value())
      .update(req.rawBody)
      .digest("hex");

    if (!signature || signature !== expectedSignature) {
      logger.warn("Rejected webhook with bad or missing x-paystack-signature");
      res.status(401).send("Invalid signature");
      return;
    }

    const event = req.body || {};

    // We only care about completed charges. Acknowledge everything else
    // (Paystack sends several event types to the same URL).
    if (event.event !== "charge.success" || !event.data?.reference) {
      res.status(200).send("Ignored");
      return;
    }

    try {
      // Rule 2: re-fetch from Paystack rather than trusting the body.
      const tx = await verifyPaystackTransaction(
        event.data.reference,
        PAYSTACK_SECRET_KEY.value(),
      );
      if (!tx?.reference) {
        res.status(200).send("No reference");
        return;
      }

      const refSnap = await db
        .collection("paymentRefs")
        .doc(tx.reference)
        .get();
      if (!refSnap.exists) {
        logger.warn("Webhook for unknown reference", {
          reference: tx.reference,
        });
        res.status(200).send("Unknown reference");
        return;
      }

      const bookingRef = db
        .collection("bookings")
        .doc(refSnap.data().bookingId);
      const result = await markBookingPaid(bookingRef, tx);

      if (result.changed) {
        logger.info("Booking paid", { bookingId: refSnap.data().bookingId });
        // Hook your staff notification in here (email / SMS / dashboard).
      }
      res.status(200).send("OK");
    } catch (err) {
      logger.error("Webhook processing failed", err);
      // 500 so Paystack retries — the payment is real, we just couldn't
      // record it this time.
      res.status(500).send("Error");
    }
  },
);

/* ------------------------------------------------------------------ */
/* 4. getBookingStatus                                                 */
/* ------------------------------------------------------------------ */

/**
 * The page polls this after the popup closes.
 *
 * If the webhook already landed, this is a cheap read. If it hasn't, we
 * ask Paystack directly by reference. That pull path is what keeps a
 * paying patient from being stuck behind a delayed or dropped webhook —
 * and it means the flow still works if the webhook is misconfigured,
 * which on a first deploy it often is.
 */
exports.getBookingStatus = onCall(
  { secrets: [PAYSTACK_SECRET_KEY] },
  async (request) => {
    const auth = requireAuth(request);
    const bookingId = cleanString(request.data?.bookingId, {
      field: "Booking",
      max: 64,
    });

    const ref = db.collection("bookings").doc(bookingId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Booking not found.");

    const booking = snap.data();
    if (booking.uid !== auth.uid) {
      throw new HttpsError("permission-denied", "This isn't your booking.");
    }
    if (booking.status === "paid") return { status: "confirmed" };
    if (!booking.lastTxRef) return { status: "pending" };

    try {
      const tx = await verifyPaystackTransaction(
        booking.lastTxRef,
        PAYSTACK_SECRET_KEY.value(),
      );

      if (tx && tx.status === "success") {
        const result = await markBookingPaid(ref, tx);
        if (result.status === "paid") return { status: "confirmed" };
        // Successful at Paystack but rejected by our checks — almost
        // always a tampered amount. Flag it rather than confirming.
        logger.warn("Successful payment failed our checks", {
          bookingId,
          reference: booking.lastTxRef,
        });
        return {
          status: "failed",
          message:
            "We couldn't match your payment to this booking. Please contact the hospital before paying again.",
        };
      }

      // Paystack uses "failed" for a declined charge and "abandoned" for
      // a popup closed without completing — both mean no booking yet.
      if (tx && (tx.status === "failed" || tx.status === "abandoned")) {
        return {
          status: "failed",
          message: "That payment didn't complete, so no booking was made.",
        };
      }

      return { status: "pending" };
    } catch (err) {
      // No transaction found yet is the normal case seconds after paying.
      logger.debug("verify not ready", { bookingId, error: err.message });
      return publicStatus(booking);
    }
  },
);
