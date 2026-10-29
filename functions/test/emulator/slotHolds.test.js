// Open appointment slots and unpaid bookings, run against the Firestore
// EMULATOR (never the live database) with a stand-in Paystack on this
// computer. An unpaid booking never holds a slot: only a charge Paystack
// reports under way does, so throwaway accounts can't hold every open time.
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
const PAYSTACK_PORT = 4596;
process.env.FUNCTIONS_EMULATOR = "true";
process.env.PAYSTACK_API_BASE = `http://127.0.0.1:${PAYSTACK_PORT}`;
process.env.PAYSTACK_SECRET_KEY = "sk_test_dummy";

const { Timestamp } = require("firebase-admin/firestore");
const { db } = require("../../lib/core");
const { createBookingDraft, initializePayment, getBookingStatus } = require("../../payments");
const { CURRENT_BOOKING_CONSENT } = require("../../lib/consentText");

const HOUR = 3600 * 1000;
const DOCTOR = "doctor1";

/* A stand-in for Paystack: verify answers from `transactions`. */
const transactions = new Map();
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  const m = req.url.match(/^\/transaction\/verify\/(.+)$/);
  const tx = m && transactions.get(decodeURIComponent(m[1]));
  res.statusCode = tx ? 200 : 404;
  res.end(JSON.stringify(tx ? { status: true, data: tx } : { status: false }));
});
const charge = (reference, status, amount = 0) =>
  transactions.set(reference, {
    reference, status, currency: "GHS", amount, id: transactions.size + 1, fees: 0,
    created_at: new Date().toISOString(),
  });

test.before(() => new Promise((resolve) => server.listen(PAYSTACK_PORT, "127.0.0.1", resolve)));
test.after(() => new Promise((resolve) => server.close(resolve)));
test.beforeEach(async () => {
  transactions.clear();
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
  assert.ok((await fetch(url, { method: "DELETE" })).ok, "emulator reset failed");
  await db.doc(`doctorProfiles/${DOCTOR}`).set({ name: "Dr Test", isListed: true, availableFor: ["OPD"] });
});

const asPatient = (uid, data, ip = "41.66.9.9") => ({
  data,
  auth: { uid, token: { role: "patient", email_verified: true, auth_time: SIGNED_IN, email: `${uid}@example.test` } },
  rawRequest: { headers: { "x-forwarded-for": ip } },
});

async function patient(uid) {
  await db.doc(`users/${uid}`).set({ status: "active", signInNotedAt: SIGNED_IN, name: "Test Patient", email: `${uid}@example.test` });
  return uid;
}

async function openSlot(id, hoursAhead = 5) {
  await db.doc(`availableSlots/${id}`).set({
    doctorUid: DOCTOR, doctorName: "Dr Test", type: "OPD", mode: "online", status: "open",
    startAt: Timestamp.fromMillis(Date.now() + hoursAhead * HOUR),
  });
}

const draftFor = (uid, slotId) =>
  createBookingDraft.run(asPatient(uid, {
    type: "OPD", mode: "online", slotId, ageYears: 30, sex: "female", town: "Berekum", area: "Central",
    phone: "0241234567", consentVersion: CURRENT_BOOKING_CONSENT,
  }));

const slot = async (id) => (await db.doc(`availableSlots/${id}`).get()).data();

test("unpaid bookings hold no slot: throwaway accounts can't empty the open times", async () => {
  for (let i = 0; i < 20; i++) await openSlot(`s${i}`, i + 2);
  for (let i = 0; i < 20; i++) await draftFor(await patient(`squat${i}`), `s${i}`);
  const open = await db.collection("availableSlots").where("status", "==", "open").get();
  assert.equal(open.size, 20);
});

test("a slot is held while Paystack reports the charge under way, for that booking only", async () => {
  await openSlot("s1");
  const a = await patient("patientA");
  const b = await patient("patientB");
  const draftA = await draftFor(a, "s1");
  const draftB = await draftFor(b, "s1"); // both filled in the form

  // A taps Pay, approves on the phone: the prompt is waiting.
  const payA = await initializePayment.run(asPatient(a, { bookingId: draftA.bookingId }));
  assert.equal((await slot("s1")).status, "open", "opening Paystack alone holds nothing");
  charge(payA.reference, "ongoing");
  assert.equal((await getBookingStatus.run(asPatient(a, { bookingId: draftA.bookingId }))).status, "pending");
  const held = await slot("s1");
  assert.equal(held.status, "held");
  assert.equal(held.bookingId, draftA.bookingId);
  assert.ok(held.heldUntil.toMillis() - Date.now() <= 15 * 60 * 1000);

  // B taps Pay now: told before paying.
  await assert.rejects(
    initializePayment.run(asPatient(b, { bookingId: draftB.bookingId })),
    /someone has just booked this appointment time/,
  );

  // A's payment goes through: the slot is A's.
  charge(payA.reference, "success", draftA.amount * 100);
  assert.equal((await getBookingStatus.run(asPatient(a, { bookingId: draftA.bookingId }))).status, "confirmed");
  const booked = await slot("s1");
  assert.equal(booked.status, "booked");
  assert.equal(booked.bookingId, draftA.bookingId);
});

test("a charge that failed doesn't hold the slot", async () => {
  await openSlot("s1");
  const a = await patient("patientA");
  const draft = await draftFor(a, "s1");
  const pay = await initializePayment.run(asPatient(a, { bookingId: draft.bookingId }));
  charge(pay.reference, "failed");
  await getBookingStatus.run(asPatient(a, { bookingId: draft.bookingId }));
  assert.equal((await slot("s1")).status, "open");
});
