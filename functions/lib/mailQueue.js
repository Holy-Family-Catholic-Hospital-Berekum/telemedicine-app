// functions/lib/mailQueue.js
//
// Outbox for appointment emails to patients and doctors. Scheduling (and
// the reminder sweep in reminders.js) writes a mail/{id} document in the
// same transaction as the change it announces, so an email is never lost
// and never sent for a change that didn't happen. functions/email.js sends
// it (immediately via a Firestore trigger, with a 15-minute retry sweep).
//
// Mail documents contain an email address and an appointment time, so
// they are deleted after MAIL_RETENTION_DAYS. Security Rules deny all
// client access.

const { db, Timestamp, serverTime } = require("./core");
const { EMAIL_CONFIGURED } = require("./mailConfig");

const MAIL_RETENTION_DAYS = 30;

/**
 * kind: see lib/emailTemplates.js (patient kinds start "appointment_" or
 *       "patient_", doctor kinds "doctor_").
 * data: { scheduledAt (ms), type, mode, doctorName, ... } per template.
 * bookingId: patient emails only. The booking's lastEmail shows admins
 *       whether the patient was told.
 * sendBefore: ms; the email is dropped if it can't go out by then
 *       (default: the appointment time).
 */
function queueEmail(tx, { to, kind, data, bookingId = null, sendBefore }) {
  if (!to) return null;
  const ref = db.collection("mail").doc();
  tx.set(ref, {
    to,
    kind,
    data: { ...data, sendBefore: sendBefore ?? data.scheduledAt },
    bookingId,
    status: "queued",
    attempts: 0,
    createdAt: serverTime(),
    deleteAt: Timestamp.fromMillis(Date.now() + MAIL_RETENTION_DAYS * 86400 * 1000),
  });
  if (bookingId) {
    tx.update(db.collection("bookings").doc(bookingId), {
      lastEmail: { status: EMAIL_CONFIGURED ? "pending" : "not_configured", kind, mailId: ref.id },
    });
  }
  return ref.id;
}

module.exports = { queueEmail };
