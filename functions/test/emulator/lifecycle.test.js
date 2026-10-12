// No-shows, "the doctor couldn't make it", closing a consultation and
// refunds, run against the Firestore EMULATOR (never the live database).
// Run from the repo root: npm run test:functions (needs Java 21), or on
// GitHub (.github/workflows/rules-tests.yml).

const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("These tests need the Firestore emulator: run `npm run test:functions` from the repo root.");
}
const PROJECT = process.env.GCLOUD_PROJECT || "demo-telemedicine";
if (!PROJECT.startsWith("demo-")) throw new Error("Refusing to run against a non-demo project.");

const { Timestamp } = require("firebase-admin/firestore");
const { db } = require("../../lib/core");
const {
  markNoShow,
  markDoctorUnavailable,
  closeConsultation,
} = require("../../lib/consultationLifecycle");
const { requestRefund } = require("../../refunds");

const MIN = 60 * 1000;
const ts = (ms) => Timestamp.fromMillis(ms);
const PATIENT = "patient1";
const DOCTOR = "doctor1";
const SYSTEM = { uid: "system", role: "system" };

async function clearFirestore() {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
  const res = await fetch(url, { method: "DELETE" });
  assert.ok(res.ok, "emulator reset failed");
}

/**
 * A paid video consultation that started `startedAgoMin` minutes ago.
 * `consultation` / `booking` fields override the defaults.
 */
async function seed({ id = "HFC-TEST000001", startedAgoMin = 10, consultation = {}, booking = {} } = {}) {
  const start = Date.now() - startedAgoMin * MIN;
  const bookingId = `b-${id}`;
  await db.doc(`users/${PATIENT}`).set({ status: "active", name: "Test Patient", email: "patient@example.test" });
  await db.doc(`adminUsers/${DOCTOR}`).set({ role: "doctor", status: "active", name: "Dr Test", email: "doctor@example.test" });
  await db.doc("adminUsers/admin1").set({ role: "admin", status: "active", name: "Admin", email: "admin@example.test" });
  await db.doc(`bookings/${bookingId}`).set({
    patientUid: PATIENT,
    patientName: "Test Patient",
    email: "patient@example.test",
    status: "scheduled",
    type: "OPD",
    mode: "online",
    consultationId: id,
    amountPaid: 150,
    currency: "GHS",
    paystackReference: `ref-${id}`,
    scheduledTime: ts(start),
    ...booking,
  });
  await db.doc(`consultations/${id}`).set({
    bookingId,
    patientUid: PATIENT,
    doctorUid: DOCTOR,
    doctorName: "Dr Test",
    type: "OPD",
    mode: "online",
    status: "scheduled",
    scheduledTime: ts(start),
    ...consultation,
  });
  return { id, bookingId, start };
}

const mailKinds = async () => (await db.collection("mail").get()).docs.map((d) => d.data().kind).sort();

test.beforeEach(clearFirestore);

/* ------------------------------ no-shows ------------------------------ */

test("patient no-show can't be marked before their deadline", async () => {
  const { id, start } = await seed({
    startedAgoMin: 2,
    consultation: { status: "in_progress", doctorFirstJoinedAt: ts(Date.now() - MIN) },
  });
  await db.doc(`consultations/${id}`).update({ waitDeadline: { for: "patient", at: ts(start + 7 * MIN) } });
  await assert.rejects(markNoShow({ consultationId: id, actor: { uid: "admin1", role: "admin" } }), /still has/);
});

test("patient no-show after the deadline: booking kept, terms fixed, patient emailed", async () => {
  const { id, bookingId } = await seed({
    startedAgoMin: 20,
    consultation: {
      status: "in_progress",
      doctorFirstJoinedAt: ts(Date.now() - 18 * MIN),
      presence: { doctor: ts(Date.now()) },
      waitDeadline: { for: "patient", at: ts(Date.now() - MIN) },
    },
  });
  assert.equal(await markNoShow({ consultationId: id, actor: SYSTEM }), true);
  const c = (await db.doc(`consultations/${id}`).get()).data();
  const b = (await db.doc(`bookings/${bookingId}`).get()).data();
  assert.equal(c.status, "no_show");
  assert.equal(b.status, "no_show");
  assert.deepEqual(b.noShowTerms, { forfeitPercent: 20, rescheduleFee: 50, waitMinutes: 5 });
  assert.deepEqual(await mailKinds(), ["patient_no_show"]);
  // Again: nothing changes.
  assert.equal(await markNoShow({ consultationId: id, actor: SYSTEM }), false);
});

test("a consultation that took place (connected) is never a no-show", async () => {
  const { id } = await seed({ consultation: { status: "in_progress", metAt: ts(Date.now() - 5 * MIN) } });
  await assert.rejects(markNoShow({ consultationId: id, actor: { uid: "admin1", role: "admin" } }), /connected|isn't a no-show/);
});

test("the patient can't be a no-show while only the doctor's deadline is running", async () => {
  const { id } = await seed({
    consultation: { status: "in_progress", patientFirstJoinedAt: ts(Date.now() - 5 * MIN), waitDeadline: { for: "doctor", at: ts(Date.now() - MIN) } },
  });
  await assert.rejects(markNoShow({ consultationId: id, actor: { uid: "admin1", role: "admin" } }), /waited in the call/);
});

/* ------------------------ doctor couldn't make it ------------------------ */

test("doctor didn't join in time: patient and admins told, free reschedule request", async () => {
  const { id, bookingId } = await seed({ startedAgoMin: 10 });
  const marked = await markDoctorUnavailable({ consultationId: id, actor: SYSTEM });
  assert.ok(marked);
  const c = (await db.doc(`consultations/${id}`).get()).data();
  const b = (await db.doc(`bookings/${bookingId}`).get()).data();
  assert.equal(c.doctorUnavailable.kind, "doctor_absent");
  assert.equal(b.rescheduleRequest.status, "requested");
  assert.equal(b.rescheduleRequest.byHospital, true);
  assert.deepEqual(await mailKinds(), ["admin_doctor_unavailable", "patient_doctor_unavailable"]);
});

test("the automatic check leaves a doctor who is in the room alone", async () => {
  const { id } = await seed({ consultation: { presence: { doctor: ts(Date.now()) } } });
  assert.equal(await markDoctorUnavailable({ consultationId: id, actor: SYSTEM }), null);
});

test("the automatic check leaves a booking re-opened after the patient's own no-show alone", async () => {
  const { id } = await seed({
    booking: { rescheduleRequest: { status: "requested", afterNoShow: true, requestedAt: ts(Date.now() - 2 * MIN) } },
  });
  assert.equal(await markDoctorUnavailable({ consultationId: id, actor: SYSTEM }), null);
});

test("'call couldn't be completed' needs the two to have been connected", async () => {
  const { id } = await seed();
  await assert.rejects(
    markDoctorUnavailable({ consultationId: id, actor: { uid: DOCTOR, role: "doctor" }, kind: "call_incomplete", expectDoctorUid: DOCTOR }),
    /never connected/,
  );
});

/* ------------------------------- closing ------------------------------- */

test("closing a no-show records the amount kept and owed, and deletes the booking details", async () => {
  const { id, bookingId } = await seed({
    consultation: { status: "no_show" },
    booking: { status: "no_show", noShowTerms: { forfeitPercent: 20, rescheduleFee: 50, waitMinutes: 5 } },
  });
  const closed = await closeConsultation({ consultationId: id, outcome: "no_show", actor: SYSTEM });
  assert.equal(closed.forfeitAmount, 30);
  assert.equal(closed.refundOwed, 120);
  const h = (await db.doc(`consultationHistory/${id}`).get()).data();
  assert.equal(h.outcome, "no_show");
  assert.equal(h.refundOwed, 120);
  assert.equal((await db.doc(`bookings/${bookingId}`).get()).exists, false);
  assert.equal((await db.doc(`consultations/${id}`).get()).exists, false);
});

test("a doctor can't close a video call as completed if they were never connected", async () => {
  const { id } = await seed();
  await assert.rejects(
    closeConsultation({ consultationId: id, outcome: "completed", actor: { uid: DOCTOR, role: "doctor" }, expectDoctorUid: DOCTOR }),
    /never connected/,
  );
});

/* ------------------------------- refunds ------------------------------- */

const asPatient = (data) => ({
  data,
  auth: { uid: PATIENT, token: { role: "patient", email_verified: true, email: "patient@example.test" } },
  rawRequest: { headers: {}, ip: "127.0.0.1" },
});

test("refund after a patient no-show: paid minus the share kept", async () => {
  const { bookingId } = await seed({
    consultation: { status: "no_show" },
    booking: { status: "no_show", noShowTerms: { forfeitPercent: 20, rescheduleFee: 50, waitMinutes: 5 } },
  });
  const res = await requestRefund.run(asPatient({ source: "booking", id: bookingId, reason: "Couldn't make it" }));
  assert.equal(res.suggestedRefund, 120);
});

test("refund when the doctor couldn't make it: in full, straight away", async () => {
  const { id, bookingId } = await seed();
  await markDoctorUnavailable({ consultationId: id, actor: SYSTEM });
  const res = await requestRefund.run(asPatient({ source: "booking", id: bookingId, reason: "Doctor didn't come" }));
  assert.equal(res.suggestedRefund, 150);
  const r = (await db.doc(`refundRequests/${id}`).get()).data();
  assert.equal(r.outcome, "doctor_unavailable");
});

test("no refund for a consultation that took place", async () => {
  const { bookingId } = await seed({
    startedAgoMin: 3 * 24 * 60,
    consultation: { metAt: ts(Date.now() - 3 * 24 * 60 * MIN) },
    booking: { metAt: ts(Date.now() - 3 * 24 * 60 * MIN) },
  });
  await assert.rejects(
    requestRefund.run(asPatient({ source: "booking", id: bookingId, reason: "Want my money" })),
    /were in the call/,
  );
});
