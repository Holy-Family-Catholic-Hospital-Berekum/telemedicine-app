// The no-show fee, run against the Firestore EMULATOR (never the live
// database) with a stand-in Paystack on this computer. A fee paid for one
// no-show must not pay for a later no-show of the same booking.
// Run from the repo root: npm run test:functions (needs Java 21).

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("These tests need the Firestore emulator: run `npm run test:functions` from the repo root.");
}
const PROJECT = process.env.GCLOUD_PROJECT || "demo-telemedicine";
if (!PROJECT.startsWith("demo-")) throw new Error("Refusing to run against a non-demo project.");
// When the test patient signed in; seeded as reported (users.signInNotedAt,
// lib/core.js requireRole).
const SIGNED_IN = Math.floor(Date.now() / 1000) - 60;

// Before lib/paystack.js loads: talk to the stand-in (emulator only).
const PAYSTACK_PORT = 4598;
process.env.FUNCTIONS_EMULATOR = "true";
process.env.PAYSTACK_API_BASE = `http://127.0.0.1:${PAYSTACK_PORT}`;
process.env.PAYSTACK_SECRET_KEY = "sk_test_dummy";

const { Timestamp } = require("firebase-admin/firestore");
const { db } = require("../../lib/core");
const { markNoShow, closeConsultation, noShowFeesOf } = require("../../lib/consultationLifecycle");
const { startNoShowReschedule, getNoShowFeeStatus } = require("../../noShow");
const { applyPaystackTransaction } = require("../../payments");
const { rescheduleConsultation } = require("../../scheduling");

const MIN = 60 * 1000;
const ts = (ms) => Timestamp.fromMillis(ms);
const PATIENT = "patient1";
const ID = "HFC-FEETEST001";
const BOOKING = "b-fee";
const FEE = 50;

/* A stand-in for Paystack: verify answers from `transactions`; refunds are accepted. */
const transactions = new Map();
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.method === "POST" && req.url === "/refund") {
    res.end(JSON.stringify({ status: true, data: { id: 1, status: "pending" } }));
    return;
  }
  const m = req.url.match(/^\/transaction\/verify\/(.+)$/);
  const tx = m && transactions.get(decodeURIComponent(m[1]));
  res.statusCode = tx ? 200 : 404;
  res.end(JSON.stringify(tx ? { status: true, data: tx } : { status: false }));
});
const succeed = (reference) => {
  const tx = { reference, status: "success", currency: "GHS", amount: FEE * 100, id: transactions.size + 1, fees: 0 };
  transactions.set(reference, tx);
  return tx;
};

test.before(() => new Promise((resolve) => server.listen(PAYSTACK_PORT, "127.0.0.1", resolve)));
test.after(() => new Promise((resolve) => server.close(resolve)));
test.beforeEach(async () => {
  transactions.clear();
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
  assert.ok((await fetch(url, { method: "DELETE" })).ok, "emulator reset failed");
});

const asPatient = (data) => ({
  data,
  auth: { uid: PATIENT, token: { role: "patient", email_verified: true, auth_time: SIGNED_IN, email: "patient@example.test" } },
  rawRequest: { headers: {}, ip: "127.0.0.1" },
});
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

async function seed() {
  await db.doc(`users/${PATIENT}`).set({ status: "active", signInNotedAt: SIGNED_IN, name: "Test Patient", email: "patient@example.test" });
  await db.doc("adminUsers/admin1").set({ role: "admin", status: "active", name: "Admin", mfaFactorUid: "factor1" });
  await db.doc("adminUsers/doctor1").set({ role: "doctor", status: "active", name: "Dr Test", email: "doctor@example.test" });
  await db.doc("doctorProfiles/doctor1").set({ name: "Dr Test", availableFor: ["OPD"] });
  await db.doc("siteSettings/public").set({ noShow: { waitMinutes: 10, forfeitPercent: 20, rescheduleFee: FEE } });
  await db.doc(`bookings/${BOOKING}`).set({
    patientUid: PATIENT, patientName: "Test Patient", email: "patient@example.test", status: "scheduled",
    type: "OPD", mode: "online", consultationId: ID, doctorUid: "doctor1", amountPaid: 150, currency: "GHS",
  });
  await db.doc(`consultations/${ID}`).set({
    bookingId: BOOKING, patientUid: PATIENT, doctorUid: "doctor1", doctorName: "Dr Test",
    type: "OPD", mode: "online", status: "scheduled",
  });
}

/** The doctor waited and the patient's time to join ran out. */
async function patientMisses() {
  const start = Date.now() - 30 * MIN;
  const at = { scheduledTime: ts(start), waitDeadline: { for: "patient", at: ts(start + 10 * MIN) } };
  await db.doc(`consultations/${ID}`).update({ ...at, doctorFirstJoinedAt: ts(start) });
  await db.doc(`bookings/${BOOKING}`).update(at);
  assert.equal(await markNoShow({ consultationId: ID, actor: { uid: "system", role: "system" } }), true);
}

/** An admin gives the reopened booking a new time (the one the patient then misses). */
async function adminGivesNewTime() {
  const inTwoHours = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  await rescheduleConsultation.run(asAdmin({ bookingId: BOOKING, scheduledTime: inTwoHours }));
}

/** First no-show, fee paid, booking reopened: the reference of that fee. */
async function firstNoShowPaid() {
  await seed();
  await patientMisses();
  const pay = await startNoShowReschedule.run(asPatient({ bookingId: BOOKING }));
  assert.equal(pay.status, "pay");
  succeed(pay.reference);
  assert.equal((await getNoShowFeeStatus.run(asPatient({ bookingId: BOOKING }))).status, "confirmed");
  assert.equal((await db.doc(`bookings/${BOOKING}`).get()).data().status, "scheduled");
  return pay.reference;
}

const booking = async () => (await db.doc(`bookings/${BOOKING}`).get()).data();

test("a fee paid for the first no-show doesn't reopen the booking after a second one", async () => {
  await firstNoShowPaid();
  await adminGivesNewTime();
  await patientMisses();

  const again = await startNoShowReschedule.run(asPatient({ bookingId: BOOKING }));
  assert.equal(again.status, "pay", "a new fee is asked for");
  assert.equal((await booking()).status, "no_show");
  assert.notEqual((await getNoShowFeeStatus.run(asPatient({ bookingId: BOOKING }))).status, "confirmed");
  assert.equal((await booking()).status, "no_show");

  // Paying the new fee reopens it.
  succeed(again.reference);
  assert.equal((await getNoShowFeeStatus.run(asPatient({ bookingId: BOOKING }))).status, "confirmed");
  assert.equal((await booking()).status, "scheduled");

  // Both fees are kept and counted when the consultation closes.
  assert.deepEqual((await booking()).noShowFees.map((x) => x.amount), [FEE, FEE]);
  await closeConsultation({ consultationId: ID, outcome: "completed", actor: { uid: "admin1", role: "admin" } });
  assert.equal((await db.doc(`consultationHistory/${ID}`).get()).data().noShowFeePaid, 2 * FEE);
});

test("a booking from before the fee list counts its one recorded fee", () => {
  assert.deepEqual(noShowFeesOf({ noShowFee: { amount: FEE, reference: "HFH-OLDFEE-b" } }), [{ amount: FEE, reference: "HFH-OLDFEE-b" }]);
  assert.deepEqual(noShowFeesOf({}), []);
});

test("the first fee's webhook sent again during a second no-show is neither applied nor refunded", async () => {
  const first = await firstNoShowPaid();
  await adminGivesNewTime();
  await patientMisses();

  assert.equal(await applyPaystackTransaction(transactions.get(first), "webhook"), "applied");
  assert.equal((await booking()).status, "no_show");
  assert.equal((await db.doc(`paymentIssues/${first}`).get()).exists, false);
});

test("an earlier no-show's unfinished attempt that succeeds later is refunded", async () => {
  await seed();
  await patientMisses();
  // An attempt the patient abandoned, then another that was paid.
  const abandoned = await startNoShowReschedule.run(asPatient({ bookingId: BOOKING }));
  transactions.set(abandoned.reference, { reference: abandoned.reference, status: "abandoned", created_at: new Date(0).toISOString() });
  const second = await startNoShowReschedule.run(asPatient({ bookingId: BOOKING }));
  succeed(second.reference);
  assert.equal((await getNoShowFeeStatus.run(asPatient({ bookingId: BOOKING }))).status, "confirmed");
  await adminGivesNewTime();
  await patientMisses();

  // The abandoned mobile money prompt is approved after all.
  const late = succeed(abandoned.reference);
  assert.equal(await applyPaystackTransaction(late, "webhook"), "flagged");
  assert.equal((await booking()).status, "no_show");
  assert.equal((await db.doc(`paymentIssues/${abandoned.reference}`).get()).data().reason, "duplicate_payment");
});
