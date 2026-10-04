// functions/lib/mailQueue.js
//
// Outbox for patient emails. Scheduling writes a mail/{id} document in the
// same transaction as the change it announces, so an email is never lost
// and never sent for a change that didn't happen. functions/email.js sends
// it (immediately via a Firestore trigger, with a 15-minute retry sweep).
//
// Mail documents contain the patient's email address and appointment, so
// they are deleted after MAIL_RETENTION_DAYS. Security Rules deny all
// client access.

const { db, Timestamp, serverTime } = require("./core");
const { EMAIL_CONFIGURED } = require("./mailConfig");

const MAIL_RETENTION_DAYS = 30;

/**
 * kind: "appointment_scheduled" | "appointment_rescheduled"
 * data: { patientName, doctorName, type, mode, scheduledAt (ms), consultationId }
 */
function queueAppointmentEmail(tx, { bookingId, to, kind, data }) {
  if (!to) return null;
  const ref = db.collection("mail").doc();
  tx.set(ref, {
    to,
    kind,
    data,
    bookingId: bookingId || null,
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

module.exports = { queueAppointmentEmail };
