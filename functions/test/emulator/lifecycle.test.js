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
// When the test patient signed in; seeded as reported (users.signInNotedAt,
// lib/core.js requireRole).
const SIGNED_IN = Math.floor(Date.now() / 1000) - 60;

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
  await db.doc(`users/${PATIENT}`).set({ status: "active", signInNotedAt: SIGNED_IN, name: "Test Patient", email: "patient@example.test" });
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

test("the admin note on 'doctor can't make it' stays off the booking the patient can read", async () => {
  const { id, bookingId } = await seed({ startedAgoMin: -60 });
  await markDoctorUnavailable({
    consultationId: id,
    actor: { uid: "admin1", role: "admin" },
    reason: "Doctor off sick",
  });
  const onBooking = (await db.doc(`bookings/${bookingId}`).get()).data().doctorUnavailable;
  assert.deepEqual(Object.keys(onBooking).sort(), ["at", "by", "kind"]);
  assert.equal(onBooking.by, "admin");
  const onConsultation = (await db.doc(`consultations/${id}`).get()).data().doctorUnavailable;
  assert.equal(onConsultation.reason, "Doctor off sick");
  assert.equal(onConsultation.byUid, "admin1");
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
  auth: { uid: PATIENT, token: { role: "patient", email_verified: true, auth_time: SIGNED_IN, email: "patient@example.test" } },
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

/* --------------------------- booking an open slot --------------------------- */

const { createBookingDraft } = require("../../payments");
const { CURRENT_BOOKING_CONSENT } = require("../../lib/consentText");

async function seedOpenSlot() {
  await db.doc(`users/${PATIENT}`).set({ status: "active", signInNotedAt: SIGNED_IN, name: "Test Patient", email: "patient@example.test" });
  await db.doc(`adminUsers/${DOCTOR}`).set({ role: "doctor", status: "active", name: "Dr Test", email: "doctor@example.test" });
  await db.doc("adminUsers/otherDoctor").set({ role: "doctor", status: "active", name: "Dr Other", email: "other@example.test" });
  for (const uid of [DOCTOR, "otherDoctor"]) {
    await db.doc(`doctorProfiles/${uid}`).set({ name: "Dr", isListed: true, isAvailable: true, availableFor: ["OPD", "SURGICAL"] });
  }
  await db.doc("availableSlots/slot1").set({
    doctorUid: DOCTOR,
    doctorName: "Dr Test",
    type: "OPD",
    mode: "online",
    status: "open",
    startAt: ts(Date.now() + 24 * 60 * MIN),
  });
}

const slotBooking = (extra) => ({
  slotId: "slot1",
  type: "OPD",
  mode: "online",
  ageYears: 34,
  sex: "female",
  town: "Berekum",
  area: "Kato",
  phone: "0241234567",
  consentVersion: CURRENT_BOOKING_CONSENT,
  ...extra,
});

test("an open slot can't be moved to another doctor", async () => {
  await seedOpenSlot();
  await assert.rejects(
    createBookingDraft.run(asPatient(slotBooking({ doctorUid: "otherDoctor" }))),
    /set doctor/,
  );
  await assert.rejects(createBookingDraft.run(asPatient(slotBooking({ type: "SURGICAL" }))), /changed/);
});

test("an open slot books its own doctor", async () => {
  await seedOpenSlot();
  const res = await createBookingDraft.run(asPatient(slotBooking({ doctorUid: DOCTOR })));
  const b = (await db.doc(`bookings/${res.bookingId}`).get()).data();
  assert.equal(b.doctorUid ?? b.requestedDoctorUid, DOCTOR);
});

/* ------------- no staff uid where a patient or anyone can read ------------- */

// An admin signed in with their pinned authenticator (core.js requireRole).
const asAdmin = (data) => ({
  data,
  auth: {
    uid: "admin1",
    token: {
      role: "admin",
      auth_time: Math.floor(Date.now() / 1000),
      firebase: { sign_in_second_factor: "totp", second_factor_identifier: "factor1" },
    },
  },
  rawRequest: { headers: {}, ip: "127.0.0.1" },
});

test("closing, declining a refund and changing settings leave no staff uid on readable documents", async () => {
  const { resolveRefundRequest } = require("../../refunds");
  const { updateDoctorSelection } = require("../../siteSettings");
  const { setCallRecordingMode } = require("../../recordings");
  const { id, bookingId } = await seed({
    consultation: { status: "no_show" },
    booking: { status: "no_show", noShowTerms: { forfeitPercent: 20, rescheduleFee: 50, waitMinutes: 5 } },
  });
  await db.doc("adminUsers/admin1").update({ mfaFactorUid: "factor1" });

  // Refund request (the patient reads it), declined by an admin.
  await requestRefund.run(asPatient({ source: "booking", id: bookingId, reason: "Couldn't make it" }));
  await resolveRefundRequest.run(asAdmin({ consultationId: id, decision: "declined", note: "Outside the policy" }));
  const request = (await db.doc(`refundRequests/${id}`).get()).data();
  assert.equal(request.status, "declined");
  assert.equal(request.resolvedByUid, undefined);

  // History (the patient reads it) after an admin closes it.
  await closeConsultation({ consultationId: id, outcome: "no_show", actor: { uid: "admin1", role: "admin" } });
  const history = (await db.doc(`consultationHistory/${id}`).get()).data();
  assert.equal(history.closedByRole, "admin");
  assert.equal(history.closedByUid, undefined);

  // Public site settings and the recording switch, each carrying an admin
  // uid an older save stored: the next save removes it.
  await db.doc("siteSettings/public").set({ updatedBy: "admin1" });
  await updateDoctorSelection.run(asAdmin({ enabled: true }));
  const settings = (await db.doc("siteSettings/public").get()).data();
  assert.equal(settings.doctorSelectionEnabled, true);
  assert.equal(settings.updatedBy, undefined);

  await db.doc("systemSettings/features").set({ updatedByUid: "admin1" });
  await setCallRecordingMode.run(asAdmin({ mode: "off" }));
  const features = (await db.doc("systemSettings/features").get()).data();
  assert.equal(features.callRecordingMode, "off");
  assert.equal(features.updatedByUid, undefined);

  // Who did each of these is in the audit log (admins only).
  const codes = (await db.collection("auditLog").where("actorId", "==", "admin1").get()).docs.map((d) => d.data().code);
  for (const code of ["payment.refund_declined", "consultation.closed_no_show"]) assert.ok(codes.includes(code), code);
});
