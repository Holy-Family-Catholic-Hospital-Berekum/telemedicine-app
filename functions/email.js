// functions/email.js
//
//   sendQueuedEmail    Firestore trigger: sends each new mail/{id} at once
//   retryQueuedEmails  every 15 min: retries temporary failures, finishes
//                      anything a crash left half-sent, deletes old mail docs
//
// Sent through Resend (https://resend.com) from the hospital's own verified
// domain (lib/mailConfig.js). Secret, never committed:
//   firebase functions:secrets:set RESEND_API_KEY
//
// Each mail document is claimed in a transaction before sending and the
// document id is sent as Resend's Idempotency-Key, so a retry can never
// deliver the same email twice. The booking gets lastEmail.status so admins
// can see whether the patient was told (and phone them if not).

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { db, Timestamp, serverTime, audit } = require("./lib/core");
const { FROM, REPLY_TO, EMAIL_CONFIGURED } = require("./lib/mailConfig");
const { renderEmail } = require("./lib/emailTemplates");

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const MAX_ATTEMPTS = 6;
const STUCK_SENDING_MINUTES = 10;

const configured = () => EMAIL_CONFIGURED;

async function setBookingEmailStatus(bookingId, status, kind) {
  if (!bookingId) return;
  await db
    .collection("bookings")
    .doc(bookingId)
    .update({ lastEmail: { status, kind, at: Timestamp.now() } })
    .catch(() => {}); // booking may already be closed and deleted
}

/** Claims a mail doc for sending; returns its data, or null if not ours to send. */
async function claim(ref) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const m = snap.data();
    const stuck =
      m.status === "sending" &&
      (m.claimedAt?.toMillis?.() ?? 0) < Date.now() - STUCK_SENDING_MINUTES * 60 * 1000;
    if (!(m.status === "queued" || m.status === "retry" || stuck)) return null;
    tx.update(ref, { status: "sending", claimedAt: serverTime(), attempts: (m.attempts || 0) + 1 });
    return { ...m, attempts: (m.attempts || 0) + 1 };
  });
}

async function deliver(ref) {
  const m = await claim(ref);
  if (!m) return;

  if (!configured()) {
    await ref.update({ status: "not_configured", updatedAt: serverTime() });
    await setBookingEmailStatus(m.bookingId, "not_configured", m.kind);
    logger.warn("Email not sent: set FROM in functions/lib/mailConfig.js to a verified domain.");
    return;
  }
  // Too late to be useful (e.g. a reminder for a time that has passed).
  if (Number(m.data?.sendBefore ?? m.data?.scheduledAt) < Date.now()) {
    await ref.update({ status: "skipped", reason: "too late to send", updatedAt: serverTime() });
    return;
  }

  const { subject, text, html } = renderEmail(m.kind, m.data || {});
  let res;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY.value().trim()}`,
        "Content-Type": "application/json",
        "Idempotency-Key": ref.id,
      },
      body: JSON.stringify({
        from: FROM,
        to: [m.to],
        reply_to: REPLY_TO,
        subject,
        text,
        html,
      }),
    });
  } catch (err) {
    res = { ok: false, status: 0, json: async () => ({ message: err.message }) };
  }
  const body = await res.json().catch(() => ({}));

  if (res.ok) {
    await ref.update({ status: "sent", providerId: body.id || null, sentAt: serverTime() });
    await setBookingEmailStatus(m.bookingId, "sent", m.kind);
    return;
  }

  const temporary = res.status === 0 || res.status === 429 || res.status >= 500;
  const giveUp = !temporary || m.attempts >= MAX_ATTEMPTS;
  const lastError = `${res.status} ${String(body.message || body.name || "").slice(0, 200)}`;
  await ref.update({ status: giveUp ? "failed" : "retry", lastError, updatedAt: serverTime() });
  if (giveUp) {
    await setBookingEmailStatus(m.bookingId, "failed", m.kind);
    await audit(null, {
      action: String(m.kind).startsWith("doctor_")
        ? "Appointment email to a doctor couldn't be sent"
        : String(m.kind).startsWith("admin_")
          ? "Email to an admin couldn't be sent"
          : "Appointment email couldn't be sent — contact the patient",
      code: "email.failed",
      category: "booking",
      result: "failed",
      targetType: m.bookingId ? "booking" : "mail",
      targetId: m.bookingId || ref.id,
      details: { error: lastError },
    });
    logger.error("Appointment email failed", { mailId: ref.id, lastError });
  }
}

exports.sendQueuedEmail = onDocumentCreated(
  { document: "mail/{mailId}", secrets: [RESEND_API_KEY] },
  async (event) => {
    if (event.data) await deliver(event.data.ref);
  },
);

exports.retryQueuedEmails = onSchedule(
  { schedule: "every 15 minutes", secrets: [RESEND_API_KEY], timeoutSeconds: 300 },
  async () => {
    const pending = await db
      .collection("mail")
      .where("status", "in", ["queued", "retry", "sending"])
      .limit(50)
      .get();
    for (const doc of pending.docs) {
      try {
        await deliver(doc.ref);
      } catch (err) {
        logger.error("Retrying email failed", { mailId: doc.id, err });
      }
    }

    const old = await db.collection("mail").where("deleteAt", "<", Timestamp.now()).limit(200).get();
    if (!old.empty) {
      const batch = db.batch();
      old.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  },
);
