// functions/payments.js
//
// Booking and Paystack payment.
//
//   createBookingDraft  (callable)  patient starts a booking; unpaid
//   initializePayment   (callable)  mints a one-use reference per attempt
//   paystackWebhook     (HTTP)      Paystack reports a completed charge
//   getBookingStatus    (callable)  the page asks "am I paid yet?"
//   resolvePaymentIssue (callable)  admin refunds a flagged payment through
//                                   Paystack, or records a manual refund
//
// Money Paystack took that can't be applied to a booking (a duplicate
// payment, a payment that arrived after the booking expired, a wrong
// amount) is flagged in paymentIssues AND refunded automatically, in full,
// to the original payment method (startIssueRefund). No judgment is
// needed for these, so no admin step; admins see the result, and step in
// only if Paystack refuses the refund.
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
const { onRequest } = require("firebase-functions/v2/https");
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
  ageInYears,
  phoneE164,
  randomCode,
  sha256,
  audit,
  rateLimit,
  onCall,
} = require("./lib/core");
const { loadPrices, doctorSelectionEnabled, inPersonPaymentRequired } = require("./siteSettings");
const {
  BOOKING_CONSENT_TEXT,
  CURRENT_BOOKING_CONSENT,
  GUARDIAN_CONSENT_TEXT,
  CURRENT_GUARDIAN_CONSENT,
} = require("./lib/consentText");

const { PAYSTACK_SECRET_KEY, PAYSTACK_API, secretKey, createRefund } = require("./lib/paystack");
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
    // deepcode ignore Sqli: Firestore document ID, not SQL; payment reference must match REFERENCE_RE (no '/'), other IDs are server-written.
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
      transactionId: paystackData.id != null ? String(paystackData.id) : null,
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
  if (created) {
    logger.warn("Payment flagged for refund", { reference: paystackData.reference, reason });
    // Automatic, full refund to the original payment method.
    await startIssueRefund(paystackData.reference, { actorId: "system" }).catch((err) =>
      logger.error("Automatic refund didn't start", { reference: paystackData.reference, err: err.message }),
    );
  }
}

/**
 * Refunds a flagged payment in full through Paystack. The issue is claimed
 * first (refund_due -> refund_starting) so it can never be refunded twice;
 * Paystack also refuses to refund more than was paid.
 * Resolves the new status: "refund_processing" (or throws).
 */
async function startIssueRefund(reference, { actorId, actorRole = null, meta = null }) {
  const ref = db.collection("paymentIssues").doc(reference);
  const issue = await db.runTransaction(async (tx) => {
    // deepcode ignore Sqli: Firestore document ID, not SQL; reference validated by REFERENCE_RE (no '/').
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Payment issue not found.");
    const d = snap.data();
    if (d.status !== "refund_due" && d.status !== "refund_failed") {
      throw new HttpsError("failed-precondition", "A refund for this payment is already under way or done.");
    }
    tx.update(ref, { status: "refund_starting", refundStartingAt: serverTime() });
    return d;
  });

  try {
    const refund = await createRefund({
      reference,
      amount: issue.amount,
      customerNote: "Refund of a payment we couldn't use for a booking (Holy Family Catholic Hospital).",
      merchantNote: `paymentIssue ${issue.reason}`,
    });
    // deepcode ignore Sqli: Firestore document ID, not SQL; reference validated by REFERENCE_RE (no '/').
    await ref.update({
      status: "refund_processing",
      paystackRefundId: refund.id,
      paystackRefundStatus: refund.status,
      refundStartedAt: serverTime(),
      refundStartedBy: actorId,
      lastRefundError: FieldValue.delete(),
    });
    await audit(null, {
      actorId,
      actorRole: actorRole || (actorId === "system" ? "system" : "admin"),
      action: "Started a Paystack refund of a flagged payment",
      code: "payment.refund_started",
      category: "payment",
      targetType: "payment",
      targetId: reference,
      patientUid: issue.patientUid || null,
      details: { amount: issue.amount, reason: issue.reason },
      meta,
    });
    return "refund_processing";
  } catch (err) {
    await ref.update({ status: "refund_due", lastRefundError: String(err.message).slice(0, 300) });
    await audit(null, {
      actorId,
      actorRole: actorRole || (actorId === "system" ? "system" : "admin"),
      action: "Paystack refused a refund of a flagged payment",
      code: "payment.refund_failed",
      category: "payment",
      result: "failed",
      targetType: "payment",
      targetId: reference,
      patientUid: issue.patientUid || null,
      details: { error: String(err.message).slice(0, 200) },
      meta,
    });
    throw new HttpsError("failed-precondition", `Paystack didn't accept the refund: ${err.message}`);
  }
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
      // deepcode ignore Sqli: Firestore document ID, not SQL; booking id comes from the server-written paymentRefs document.
      const result = await markBookingPaid(bookingRef, tx, "verify_api");
      if (result.status === "paid") return "paid";
      if (result.status === "rejected") {
        // deepcode ignore Sqli: Firestore document ID, not SQL; reference validated by REFERENCE_RE; IDs are server-written.
        await recordPaymentIssue(tx, {
          reason: "amount_mismatch",
          bookingId: bookingRef.id,
          patientUid: booking.patientUid,
        });
        return "rejected";
      }
      if (result.duplicate) {
        // deepcode ignore Sqli: Firestore document ID, not SQL; reference validated by REFERENCE_RE; IDs are server-written.
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
    // deepcode ignore Sqli: Firestore document ID, not SQL; booking id comes from the server-written paymentRefs document.
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
      // deepcode ignore Sqli: Firestore document ID, not SQL; slot id read from the server-written booking.
      const slotSnap = await tx.get(slotRef);
      const slot = slotSnap.exists ? slotSnap.data() : null;
      slotOk =
        !!slot &&
        (slot.bookingId === bookingRef.id || slot.status === "open") &&
        slot.status !== "cancelled" &&
        slot.status !== "booked";
    }

    const amountPaid = Number(paystackData.amount) / 100; // pesewas -> GHS

    // deepcode ignore Sqli: Firestore document ID, not SQL; booking id comes from the server-written paymentRefs document.
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
 * data: { type, mode, dateOfBirth?, sex?, town?, area?, phone?,
 *         doctorUid?, slotId?, consentVersion,
 *         forChild?, childName?, guardianConsentVersion? }
 *
 * Accounts belong to adults. A booking is either for the account holder
 * or for their child under 18 (Ghana Data Protection Act, 2012 (Act 843):
 * a child's data needs a parent's or guardian's consent). A child's booking
 * carries the child's name and a guardian consent record; the account
 * holder is kept as guardianName and is the one emailed.
 *
 * What we ask for depends on the mode (medical director):
 *   video call       date of birth, sex and location (the doctor needs them
 *                    before the call; the age check uses the date of birth).
 *                    The phone (the mobile money number) comes with
 *                    initializePayment, on the payment page.
 *   at the hospital  nothing clinical: the hospital takes details at the
 *                    visit. Only a phone number, sent here if the visit is
 *                    free to book, otherwise with initializePayment.
 * When the admin has switched in-person payment off
 * (siteSettings/public.inPersonPaymentRequired === false), a hospital visit
 * is booked straight away (status "paid", payAtHospital: true, amount due
 * at the hospital), limited to one open visit per patient so free bookings
 * can't block the calendar.
 */
exports.createBookingDraft = onCall({ secrets: [PAYSTACK_SECRET_KEY] }, async (request) => {
  const caller = await requireRole(request, ["patient"]);
  requireVerifiedEmail(caller);
  const uid = caller.uid;
  const d = request.data || {};

  let type = oneOf(d.type, TYPES, "consultation type");
  let mode = oneOf(d.mode, MODES, "consultation mode");
  const slotId = d.slotId ? docId(d.slotId, "Slot") : null;
  // A slot decides the mode (read again in the transaction); until then,
  // trust what was sent only to pick which details to check.
  if (slotId) {
    const slotSnap = await db.collection("availableSlots").doc(slotId).get();
    if (slotSnap.exists && MODES.includes(slotSnap.data().mode)) mode = slotSnap.data().mode;
  }
  const online = mode === "online";
  const dob = online ? dateOfBirth(d.dateOfBirth) : null;
  const sex = online ? oneOf(d.sex, SEXES, "sex") : null;
  const town = online ? str(d.town, { field: "Town", max: 80 }) : null;
  const area = online ? str(d.area, { field: "Area", max: 120 }) : null;
  const phone = d.phone ? phoneE164(d.phone) : null;
  let doctorUid = d.doctorUid ? docId(d.doctorUid, "Doctor") : null;

  if (d.consentVersion !== CURRENT_BOOKING_CONSENT) {
    throw new HttpsError(
      "failed-precondition",
      "The consent wording has changed. Please reload the page and review it.",
    );
  }
  const forChild = d.forChild === true;
  // Age is checked only where a date of birth is asked for (video calls);
  // every account holder has declared they are 18 or over at sign-up.
  const age = dob ? ageInYears(dob) : null;
  let childName = null;
  if (forChild) {
    childName = str(d.childName, { field: "Child's full name", max: 100, min: 2 });
    if (age !== null && age >= 18) {
      throw new HttpsError(
        "invalid-argument",
        "This date of birth is 18 or over. Adults book from their own account.",
      );
    }
    if (d.guardianConsentVersion !== CURRENT_GUARDIAN_CONSENT) {
      throw new HttpsError(
        "failed-precondition",
        "Please confirm you are the child's parent or guardian and give consent for them.",
      );
    }
  } else if (age !== null && age < 18) {
    throw new HttpsError(
      "invalid-argument",
      "You must be 18 or older to book for yourself. If this booking is for your child, choose \"My child\".",
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

  const payAtHospital = mode === "in_person" && !(await inPersonPaymentRequired());
  if (payAtHospital && !phone) {
    throw new HttpsError("invalid-argument", "Enter a phone number we can call you on.");
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
      if (slot.mode !== mode) {
        throw new HttpsError("failed-precondition", "That slot has changed. Please reload the page.");
      }
      amount = prices[type];
    }

    // Free hospital visits: one open visit per patient.
    if (payAtHospital) {
      const open = await tx.get(
        db.collection("bookings")
          .where("patientUid", "==", uid)
          .where("payAtHospital", "==", true)
          .where("status", "in", ["paid", "scheduled"])
          .limit(1),
      );
      if (!open.empty) {
        throw new HttpsError(
          "failed-precondition",
          "You already have a hospital visit booked. You can book another one after that visit.",
        );
      }
    }

    let doctorName = null;
    if (doctorUid) {
      // deepcode ignore Sqli: Firestore document ID, not SQL; doctorUid passed docId() (/^[A-Za-z0-9_-]+$/) or came from a server-written slot.
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
      tx.update(
        slotRef,
        payAtHospital
          ? { status: "booked", bookingId: bookingRef.id, heldUntil: FieldValue.delete(), updatedAt: serverTime() }
          : {
              status: "held",
              heldByUid: uid,
              bookingId: bookingRef.id,
              heldUntil: Timestamp.fromMillis(now + SLOT_HOLD_MINUTES * 60 * 1000),
              updatedAt: serverTime(),
            },
      );
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

    if (forChild) {
      tx.set(db.collection("consents").doc(), {
        subjectUid: uid,
        consentType: "guardian_consent",
        action: "granted",
        context: "booking",
        version: CURRENT_GUARDIAN_CONSENT,
        textSha256: sha256(GUARDIAN_CONSENT_TEXT[CURRENT_GUARDIAN_CONSENT]),
        bookingId: bookingRef.id,
        at: serverTime(),
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }

    tx.set(bookingRef, {
      patientUid: uid,
      // For a child: the child is the patient, the account holder their
      // parent or guardian. Deleted with the booking when it closes.
      patientName: forChild ? childName : caller.profile.name || null,
      forChild,
      guardianName: forChild ? caller.profile.name || null : null,
      email: caller.token.email || null,
      type,
      mode,
      // Personal details (video calls only): deleted with the booking when
      // it closes.
      dateOfBirth: dob,
      sex,
      location: online ? `${area}, ${town}` : null,
      phone,
      requestedDoctorUid: doctorUid,
      requestedDoctorName: doctorName,
      slotId,
      preferredTime: slot?.startAt || null,
      amount, // whole GHS
      currency: CURRENCY,
      txRefs: [],
      consentId: consentRef.id,
      createdAt: serverTime(),
      updatedAt: serverTime(),
      ...(payAtHospital
        ? {
            // Booked now; the patient pays `amount` at the hospital.
            status: "paid",
            payAtHospital: true,
            amountPaid: 0,
            bookedAt: serverTime(),
            ...(slotRef ? { slotLost: false } : {}),
          }
        : {
            status: "awaiting_payment",
            expiresAt: Timestamp.fromMillis(now + DRAFT_LIFETIME_HOURS * 3600 * 1000),
          }),
    });

    audit(tx, {
      actorId: uid,
      actorRole: "patient",
      action: payAtHospital ? "Booked a hospital visit (pays at the hospital)" : "Started a booking",
      code: "booking.created",
      category: "booking",
      targetType: "booking",
      targetId: bookingRef.id,
      patientUid: uid,
      meta,
    });
  });

  return {
    bookingId: bookingRef.id,
    amount,
    currency: CURRENCY,
    type,
    mode,
    status: payAtHospital ? "booked" : "awaiting_payment",
    payAtHospital,
  };
});

/* ------------------------------------------------------------------ */
/* initializePayment                                                   */
/* ------------------------------------------------------------------ */

/**
 * data: { bookingId, phone? } — phone: the mobile money number the patient
 * will pay with (asked for on the payment page; kept on the booking as the
 * contact number too).
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
  const phone = request.data?.phone ? phoneE164(request.data.phone) : booking.phone;
  if (!phone) {
    throw new HttpsError("invalid-argument", "Enter the mobile money number you will pay with.");
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
    phone,
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
      phone,
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
      logger.warn("Rejected webhook with bad or missing signature", { ip: req.ip });
      // Audit at most 10 forged requests per hour per sender, so a flood
      // can't bury the audit log (the rest are still in the function logs).
      const sender = String(req.ip || "unknown").replace(/[^A-Za-z0-9.:-]/g, "_").slice(0, 64);
      const shouldAudit = await rateLimit(`ip-${sender}`, "webhookForgedAudit", { max: 10, windowSeconds: 3600 })
        .then(() => true, () => false);
      if (shouldAudit) {
        await audit(null, {
          action: "Rejected a payment webhook with a bad signature",
          code: "webhook.signature_invalid",
          category: "security",
          result: "denied",
          meta: { ip: req.ip || null, userAgent: null },
        }).catch(() => {});
      }
      res.status(401).send("Invalid signature");
      return;
    }

    const event = req.body || {};
    // Refund progress: re-read the refund from Paystack (refundSync.js).
    if (typeof event.event === "string" && event.event.startsWith("refund.")) {
      try {
        const { handleRefundEvent } = require("./refundSync");
        await handleRefundEvent(event.data || {});
        res.status(200).send("OK");
      } catch (err) {
        logger.error("Refund webhook processing failed", err);
        res.status(500).send("Error");
      }
      return;
    }
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
      const ids = { bookingId: bookingRef.id, patientUid: refSnap.data().patientUid };

      // A no-show reschedule fee (noShow.js), not a consultation fee.
      if (refSnap.data().purpose === "noshow_fee") {
        const { markNoShowFeePaid } = require("./noShow");
        const fee = await markNoShowFeePaid(bookingRef, tx, "webhook");
        if (tx.status === "success" && (fee.status === "rejected" || fee.status === "missing" || fee.duplicate)) {
          await recordPaymentIssue(tx, {
            reason: fee.duplicate ? "duplicate_payment" : fee.status === "missing" ? "no_matching_booking" : "amount_mismatch",
            ...ids,
          });
        }
        res.status(200).send("OK");
        return;
      }

      const result = await markBookingPaid(bookingRef, tx, "webhook");
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
 * data: { reference, method: "paystack" | "manual", note? }
 * paystack: (re)try the refund through Paystack (when the automatic one
 *           was refused). manual: record a refund made outside Paystack
 *           (note required). Audited.
 */
exports.resolvePaymentIssue = onCall({ secrets: [PAYSTACK_SECRET_KEY] }, async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const reference = str(request.data?.reference, { field: "Reference", max: 160 });
  if (!isOurReference(reference)) {
    throw new HttpsError("invalid-argument", "That reference isn't valid.");
  }
  const meta = requestMeta(request);
  if (request.data?.method === "paystack") {
    await rateLimit(caller.uid, "refundViaPaystack", { max: 30, windowSeconds: 3600 });
    const status = await startIssueRefund(reference, { actorId: caller.uid, actorRole: "admin", meta });
    return { status };
  }

  const note = str(request.data?.note, { field: "Note", max: 300, min: 3 });
  const ref = db.collection("paymentIssues").doc(reference);
  await db.runTransaction(async (tx) => {
    // deepcode ignore Sqli: Firestore document ID, not SQL; reference validated by isOurReference (REFERENCE_RE, no '/').
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Payment issue not found.");
    if (!["refund_due", "refund_failed"].includes(snap.data().status)) {
      throw new HttpsError("failed-precondition", "This one is already resolved or being refunded.");
    }
    // deepcode ignore Sqli: Firestore document ID, not SQL; reference validated by isOurReference (REFERENCE_RE, no '/').
    tx.update(ref, {
      status: "refunded",
      refundMethod: "manual",
      resolvedByUid: caller.uid,
      resolvedAt: serverTime(),
      note,
    });
    audit(tx, {
      actorId: caller.uid,
      actorRole: "admin",
      action: "Recorded a manual refund of a flagged payment",
      code: "payment.refunded",
      category: "payment",
      targetType: "payment",
      targetId: reference,
      patientUid: snap.data().patientUid || null,
      reason: note,
      meta,
    });
  });
  return { status: "refunded" };
});

// Shared with maintenance.js. Not Cloud Functions: index.js only re-exports
// the functions above by name.
exports.markBookingPaid = markBookingPaid;
exports.recordPaymentIssue = recordPaymentIssue;
exports.startIssueRefund = startIssueRefund;
exports.isOurReference = isOurReference;
exports.checkAttempts = checkAttempts;
exports.secretKey = secretKey;
exports.verifyPaystackTransaction = verifyPaystackTransaction;
exports.PAYSTACK_SECRET_KEY = PAYSTACK_SECRET_KEY;
