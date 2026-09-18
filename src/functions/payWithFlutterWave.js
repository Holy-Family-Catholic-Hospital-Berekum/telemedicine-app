/**
 * functions/index.js
 * Payment backend for the consultation booking flow.
 *
 * ── THE SECURITY MODEL IN ONE PARAGRAPH ──────────────────────────────
 * The browser is treated as hostile. It can ask to create a draft and it
 * can ask what a booking's status is — that's all. It cannot set the
 * fee, cannot mark anything paid, and is never told anything it could
 * use to move money. The fee comes from CONSULTATION_FEES below, on the
 * server. Confirmation comes from Flutterwave's own API, reached with a
 * secret key that exists only here. Firestore rules (see
 * firestore.rules) stop the client writing booking status directly, and
 * these functions use the Admin SDK, which bypasses those rules — so the
 * only path to "paid" runs through code you control.
 *
 * ── THE FOUR FUNCTIONS ───────────────────────────────────────────────
 * createBookingDraft  (callable)  patient starts a booking; unpaid
 * initializePayment   (callable)  mints a one-use tx_ref for an attempt
 * flutterwaveWebhook  (HTTP)      Flutterwave tells us money arrived
 * getBookingStatus    (callable)  patient's page asks "am I paid yet?"
 *
 * Two independent things can confirm a payment: the webhook (push) and
 * getBookingStatus's verify-by-reference (pull). Either alone is enough.
 * Having both means a missed webhook doesn't strand a paying patient,
 * and a patient who closes the tab still gets their booking.
 *
 * ── SECRETS ──────────────────────────────────────────────────────────
 * Set these once, they are never committed to git:
 *   firebase functions:secrets:set FLW_SECRET_KEY
 *   firebase functions:secrets:set FLW_SECRET_HASH
 * FLW_SECRET_HASH is a long random string you invent and also paste into
 * the Flutterwave dashboard's webhook settings. It's how we know a
 * webhook request is really from Flutterwave and not from someone who
 * guessed the URL.
 *
 * Requires Node 20+ and the Blaze plan (Cloud Functions can't make
 * outbound calls to Flutterwave on the free Spark plan).
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

admin.initializeApp();
const db = admin.firestore();

// Keep this in step with FUNCTIONS_REGION in bookConsultation.jsx.
setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

const FLW_SECRET_KEY = defineSecret("FLW_SECRET_KEY");
const FLW_SECRET_HASH = defineSecret("FLW_SECRET_HASH");

const FLW_API = "https://api.flutterwave.com/v3";

// The only authoritative fee table. Never accept an amount from a client.
const CONSULTATION_FEES = {
  OPD: 50,
  SURGICAL: 100,
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
 * one to Flutterwave, which does its own validation at the modal.
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

/** Server-to-server call to Flutterwave. The secret key never leaves here. */
async function flwGet(path, secretKey) {
  const res = await fetch(`${FLW_API}${path}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Flutterwave ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * The gate. Given what Flutterwave reports about a transaction and what
 * we expected, decide whether this counts as paid.
 *
 * Checking the amount and currency here is not paranoia: the amount in
 * the inline modal comes from the browser, so a user can edit it before
 * paying. Without this check, someone could pay GHS 1 for a GHS 100
 * consultation. We compare against our own record instead.
 */
function paymentIsAcceptable(flwData, booking) {
  if (!flwData) return false;
  if (flwData.status !== "successful") return false;
  if (flwData.currency !== booking.currency) return false;
  // charged_amount can exceed amount with fees; amount is what we asked for.
  if (Number(flwData.amount) < Number(booking.amount)) return false;
  // The reference must be one we minted for THIS booking.
  if (!booking.txRefs || !booking.txRefs.includes(flwData.tx_ref)) return false;
  return true;
}

/**
 * Flip a booking to paid, exactly once.
 *
 * Idempotency matters here. Flutterwave retries webhooks, and the patient's
 * page may be polling at the same moment, so this can run twice for one
 * payment. The transaction re-reads status inside the lock and bails if
 * it's already paid, so a double delivery can't create a second booking or
 * a second notification.
 */
async function markBookingPaid(bookingRef, flwData) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists) return { changed: false, status: "failed" };

    const booking = snap.data();
    if (booking.status === "paid") return { changed: false, status: "paid" };

    if (!paymentIsAcceptable(flwData, booking)) {
      return { changed: false, status: booking.status };
    }

    tx.update(bookingRef, {
      status: "paid",
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      flwTransactionId: String(flwData.id),
      flwTxRef: flwData.tx_ref,
      amountPaid: Number(flwData.amount),
      paymentChannel: flwData.payment_type || null,
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

  const amount = CONSULTATION_FEES[d.type];
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
    amount,
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
 * Mints a fresh tx_ref for one payment attempt and records it against the
 * booking. A new reference per attempt is what makes retries safe: a
 * failed attempt's reference can never be reused to claim a later
 * success, and each reference maps to exactly one booking.
 *
 * With the inline modal there's no Flutterwave API call to make here —
 * the modal is opened client-side with the public key. The security comes
 * from verification afterwards, not from this step.
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

  const txRef = `HFH-${bookingId}-${Date.now()}`;

  await ref.update({
    txRefs: admin.firestore.FieldValue.arrayUnion(txRef),
    lastTxRef: txRef,
    lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Reverse lookup so the webhook can find the booking from a tx_ref
  // without scanning the collection.
  await db.collection("paymentRefs").doc(txRef).set({
    bookingId,
    uid: auth.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    txRef,
    amount: booking.amount,
    currency: booking.currency,
    customer: {
      name: auth.token.name || "",
      email: auth.token.email || "",
      phone: booking.phone,
    },
  };
});

/* ------------------------------------------------------------------ */
/* 3. flutterwaveWebhook                                               */
/* ------------------------------------------------------------------ */

/**
 * Flutterwave calls this when a charge completes. Three rules:
 *
 * 1. Verify the sender. The verif-hash header must equal our secret hash.
 *    Without this, anyone who finds the URL could POST a fake success.
 * 2. Don't trust the payload's numbers. The body says a payment
 *    succeeded; we call the verify endpoint and believe that instead.
 * 3. Always answer 200 quickly, even for events we ignore. A non-200
 *    makes Flutterwave retry, and retrying a webhook we deliberately
 *    skipped is just noise.
 */
exports.flutterwaveWebhook = onRequest(
  { secrets: [FLW_SECRET_KEY, FLW_SECRET_HASH], cors: false },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const signature = req.headers["verif-hash"];
    if (!signature || signature !== FLW_SECRET_HASH.value()) {
      logger.warn("Rejected webhook with bad or missing verif-hash");
      res.status(401).send("Invalid signature");
      return;
    }

    const event = req.body || {};
    const data = event.data || {};

    // We only care about completed charges. Acknowledge everything else.
    if (data.status !== "successful" || !data.id) {
      res.status(200).send("Ignored");
      return;
    }

    try {
      // Rule 2: re-fetch from Flutterwave rather than trusting the body.
      const verified = await flwGet(
        `/transactions/${data.id}/verify`,
        FLW_SECRET_KEY.value(),
      );
      const tx = verified?.data;
      if (!tx?.tx_ref) {
        res.status(200).send("No reference");
        return;
      }

      const refSnap = await db.collection("paymentRefs").doc(tx.tx_ref).get();
      if (!refSnap.exists) {
        logger.warn("Webhook for unknown tx_ref", { txRef: tx.tx_ref });
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
      // 500 so Flutterwave retries — the payment is real, we just couldn't
      // record it this time.
      res.status(500).send("Error");
    }
  },
);

/* ------------------------------------------------------------------ */
/* 4. getBookingStatus                                                 */
/* ------------------------------------------------------------------ */

/**
 * The page polls this after the modal closes.
 *
 * If the webhook already landed, this is a cheap read. If it hasn't, we
 * ask Flutterwave directly by reference. That pull path is what keeps a
 * paying patient from being stuck behind a delayed or dropped webhook —
 * and it means the flow still works if the webhook is misconfigured,
 * which on a first deploy it often is.
 */
exports.getBookingStatus = onCall(
  { secrets: [FLW_SECRET_KEY] },
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
      const verified = await flwGet(
        `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(
          booking.lastTxRef,
        )}`,
        FLW_SECRET_KEY.value(),
      );
      const tx = verified?.data;

      if (tx && tx.status === "successful") {
        const result = await markBookingPaid(ref, tx);
        if (result.status === "paid") return { status: "confirmed" };
        // Successful at Flutterwave but rejected by our checks — almost
        // always a tampered amount. Flag it rather than confirming.
        logger.warn("Successful payment failed our checks", {
          bookingId,
          txRef: booking.lastTxRef,
        });
        return {
          status: "failed",
          message:
            "We couldn't match your payment to this booking. Please contact the hospital before paying again.",
        };
      }

      if (tx && tx.status === "failed") {
        return {
          status: "failed",
          message: "That payment didn't complete, so no booking was made.",
        };
      }

      return { status: "pending" };
    } catch (err) {
      // No transaction found yet is the normal case seconds after paying.
      logger.debug("verify_by_reference not ready", { bookingId });
      return publicStatus(booking);
    }
  },
);
