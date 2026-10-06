// functions/reminders.js
//
//   sendAppointmentReminders  every 5 min: queues reminder emails to the
//                             patient and the doctor, and a "you haven't
//                             joined" email when an online call is due
//
// What goes out, to each side separately:
//   24h  about a day before (skipped if they were told the time in the
//        last 6 hours)
//   1h   about an hour before (skipped if told in the last 30 minutes)
//   late online only: 5 minutes after the start time, to whoever hasn't
//        joined the call yet (the doctor's says if the patient is waiting)
//
// Each one is recorded under consultations.reminders.<key>, set in the same
// transaction that queues the mail, so nothing is sent twice. A reschedule
// clears `reminders` (scheduling.js) so the new time gets its own. Emails
// go through the outbox (lib/mailQueue.js); like email.js this job is only
// deployed once a verified sending domain is set in lib/mailConfig.js.

const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { db, Timestamp, toDate } = require("./lib/core");
const { queueEmail } = require("./lib/mailQueue");
const { loadNoShowPolicy } = require("./siteSettings");

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// Window [from, to) relative to the start time, and how long after the
// patient/doctor was told the time before this reminder is worth sending.
const REMINDERS = [
  { lead: "24h", from: -24 * HOUR, to: -3 * HOUR, quietAfterSet: 6 * HOUR },
  { lead: "1h", from: -60 * MIN, to: -5 * MIN, quietAfterSet: 30 * MIN },
];
const LATE_FROM = 5 * MIN;
const LATE_TO = 60 * MIN;

/** Reminder keys due for consultation `c` at `now` that haven't gone out. */
function dueReminders(c, now) {
  const start = toDate(c.scheduledTime)?.getTime();
  if (!start) return [];
  const sent = c.reminders || {};
  const setAt = toDate(c.scheduleSetAt || c.createdAt)?.getTime() ?? 0;
  const due = [];

  for (const r of REMINDERS) {
    const inWindow = now >= start + r.from && now < start + r.to;
    if (!inWindow || now - setAt < r.quietAfterSet) continue;
    for (const who of ["patient", "doctor"]) {
      const key = `${who}${r.lead}`;
      if (!sent[key]) due.push({ key, who, kind: `${who}_reminder`, lead: r.lead });
    }
  }

  if (c.mode === "online" && now >= start + LATE_FROM && now < start + LATE_TO) {
    if (!c.patientFirstJoinedAt && !sent.patientLate) {
      due.push({ key: "patientLate", who: "patient", kind: "patient_not_joined", otherJoined: Boolean(c.doctorFirstJoinedAt) });
    }
    if (!c.doctorFirstJoinedAt && !sent.doctorLate) {
      due.push({ key: "doctorLate", who: "doctor", kind: "doctor_not_joined", otherJoined: Boolean(c.patientFirstJoinedAt) });
    }
  }
  return due;
}

exports.sendAppointmentReminders = onSchedule(
  { schedule: "every 5 minutes", timeoutSeconds: 120 },
  async () => {
    const now = Date.now();
    // Single-field range on scheduledTime: no composite index needed.
    const snap = await db
      .collection("consultations")
      .where("scheduledTime", ">=", Timestamp.fromMillis(now - LATE_TO))
      .where("scheduledTime", "<=", Timestamp.fromMillis(now + 24 * HOUR))
      .get();

    // The no-show rule goes into every patient email (lib/emailTemplates.js).
    const noShow = snap.empty ? null : await loadNoShowPolicy();
    let queued = 0;
    for (const doc of snap.docs) {
      if (dueReminders(doc.data(), now).length === 0) continue;
      try {
        queued += await db.runTransaction(async (tx) => {
          const fresh = await tx.get(doc.ref);
          const c = fresh.exists ? fresh.data() : null;
          if (!c || !["scheduled", "in_progress"].includes(c.status)) return 0;
          // deepcode ignore Sqli: Firestore document ID, not SQL; the consultation is read back by its own reference.
          const due = dueReminders(c, Date.now());
          if (due.length === 0) return 0;

          const [bookingSnap, doctorSnap] = await Promise.all([
            // deepcode ignore Sqli: Firestore document ID, not SQL; bookingId read from a server-written consultation.
            tx.get(db.collection("bookings").doc(c.bookingId)),
            // deepcode ignore Sqli: Firestore document ID, not SQL; doctorUid read from a server-written consultation.
            tx.get(db.collection("adminUsers").doc(c.doctorUid)),
          ]);
          const booking = bookingSnap.exists ? bookingSnap.data() : {};
          const doctor = doctorSnap.exists ? doctorSnap.data() : {};
          const start = toDate(c.scheduledTime).getTime();
          const base = {
            doctorName: c.doctorName || doctor.name || "",
            type: c.type,
            mode: c.mode,
            scheduledAt: start,
          };

          const updates = {};
          for (const r of due) {
            const late = r.kind.endsWith("_not_joined");
            const extra = late ? { otherJoined: r.otherJoined } : { lead: r.lead };
            if (r.who === "patient") {
              queueEmail(tx, {
                bookingId: bookingSnap.exists ? c.bookingId : null,
                to: booking.email,
                kind: r.kind,
                data: {
                  ...base,
                  ...extra,
                  // The account holder (a child's parent or guardian).
                  patientName: booking.guardianName || booking.patientName || c.patientName || "",
                  noShow,
                  consultationId: doc.id,
                },
                sendBefore: late ? start + LATE_TO : start,
              });
            } else if (doctor.status === "active") {
              queueEmail(tx, {
                to: doctor.email,
                kind: r.kind,
                data: { ...base, ...extra, doctorName: doctor.name || base.doctorName },
                sendBefore: late ? start + LATE_TO : start,
              });
            }
            // Marked even when there's no address, so it isn't retried.
            updates[`reminders.${r.key}`] = Timestamp.now();
          }
          tx.update(doc.ref, updates);
          return due.length;
        });
      } catch (err) {
        logger.error("Reminder failed", { consultationId: doc.id, err });
      }
    }
    if (queued) logger.info("Appointment reminders queued", { queued });
  },
);

exports.dueReminders = dueReminders; // for local testing
