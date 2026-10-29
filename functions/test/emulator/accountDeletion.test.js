// What a deleted patient account gets back (lib/accountDeletion.js), run
// against the Firestore EMULATOR (never the live database) with a stand-in
// Paystack on this computer. A patient can delete their own account from
// the browser, so deleting it must refund no more than asking for a refund
// would (hospital decision, 29 Oct 2026).
// Run from the repo root: npm run test:functions (needs Java 21).

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("These tests need the Firestore emulator: run `npm run test:functions` from the repo root.");
}
const PROJECT = process.env.GCLOUD_PROJECT || "demo-telemedicine";
if (!PROJECT.startsWith("demo-")) throw new Error("Refusing to run against a non-demo project.");

// Before lib/paystack.js loads: talk to the stand-in (emulator only).
const PAYSTACK_PORT = 4597;
process.env.FUNCTIONS_EMULATOR = "true";
process.env.PAYSTACK_API_BASE = `http://127.0.0.1:${PAYSTACK_PORT}`;
process.env.PAYSTACK_SECRET_KEY = "sk_test_dummy";

const { Timestamp } = require("firebase-admin/firestore");
const { db } = require("../../lib/core");
const { purgePatientData, refundOnDeletion } = require("../../lib/accountDeletion");

const PATIENT = "patient1";
const SYSTEM = { uid: "system", role: "system" };
const PAID_REF = "HFH-PAYREF-b1";
const FEE_REF = "HFH-FEEREF-b1";

// Refunds asked of the stand-in Paystack: { transaction, amount (pesewas) }.
const refunds = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === "/refund") refunds.push(JSON.parse(body));
    res.end(JSON.stringify({ status: true, data: { id: refunds.length, status: "pending" } }));
  });
});

test.before(() => new Promise((resolve) => server.listen(PAYSTACK_PORT, "127.0.0.1", resolve)));
test.after(() => new Promise((resolve) => server.close(resolve)));
test.beforeEach(async () => {
  refunds.length = 0;
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
  assert.ok((await fetch(url, { method: "DELETE" })).ok, "emulator reset failed");
});

/** A patient with one paid video booking; `booking` overrides the defaults. */
async function seed(booking = {}) {
  await db.doc(`users/${PATIENT}`).set({ status: "active", name: "Test Patient" });
  await db.doc("bookings/b1").set({
    patientUid: PATIENT, status: "scheduled", type: "OPD", mode: "online",
    amountPaid: 150, currency: "GHS", paystackReference: PAID_REF, paystackTransactionId: "1",
    ...booking,
  });
}

const refunded = () => refunds.map((r) => [r.transaction, r.amount / 100]);

test("a missed (held no-show) booking: deleting the account refunds paid minus the share kept, not in full", async () => {
  await seed({ status: "no_show", noShowTerms: { forfeitPercent: 20, rescheduleFee: 50, waitMinutes: 10 } });
  await purgePatientData(PATIENT, { actor: SYSTEM });
  assert.deepEqual(refunded(), [[PAID_REF, 120]]);
  assert.equal((await db.doc(`paymentIssues/${PAID_REF}`).get()).data().reason, "account_deleted");
});

test("a booking reopened after a no-show: the consultation is refunded, the no-show fee is kept", async () => {
  const fee = { amount: 50, reference: FEE_REF, paidAt: Timestamp.now(), via: "webhook" };
  await seed({ feeTxRefs: [FEE_REF], noShowFee: fee, noShowFees: [fee], lateRescheduleFees: [{ amount: 30, reference: "HFH-LATEFE-b1" }] });
  await purgePatientData(PATIENT, { actor: SYSTEM });
  assert.deepEqual(refunded(), [[PAID_REF, 150]]);
  assert.equal((await db.doc(`paymentIssues/${FEE_REF}`).get()).exists, false);
});

test("a refund already under way isn't paid again; one only asked for is closed", async () => {
  await seed({ consultationId: "HFC-DELTEST001" });
  await db.doc("refundRequests/HFC-DELTEST001").set({ patientUid: PATIENT, status: "processing" });
  await purgePatientData(PATIENT, { actor: SYSTEM });
  assert.deepEqual(refunded(), []);

  await seed({ consultationId: "HFC-DELTEST002" });
  await db.doc("refundRequests/HFC-DELTEST002").set({ patientUid: PATIENT, status: "requested" });
  await purgePatientData(PATIENT, { actor: SYSTEM });
  assert.deepEqual(refunded(), [[PAID_REF, 150]]);
  assert.equal((await db.doc("refundRequests/HFC-DELTEST002").get()).data().status, "declined");
});

test("refundOnDeletion follows the refund rules", () => {
  const base = { status: "scheduled", amountPaid: 150, paystackReference: PAID_REF };
  const amount = (b) => refundOnDeletion({ ...base, ...b })?.amount ?? 0;
  assert.equal(amount({}), 150, "not attended yet: in full");
  assert.equal(amount({ status: "paid" }), 150, "not scheduled yet: in full");
  assert.equal(amount({ metAt: Timestamp.now() }), 0, "took place: nothing");
  assert.equal(amount({ metAt: Timestamp.now(), doctorUnavailable: { kind: "call_incomplete" } }), 150, "call couldn't be completed: in full");
  assert.equal(amount({ doctorUnavailable: { kind: "doctor_absent" } }), 150, "doctor couldn't make it: in full");
  assert.equal(amount({ status: "no_show", noShowTerms: { forfeitPercent: 100 } }), 0, "no-show, policy keeps all: nothing");
  assert.equal(amount({ status: "no_show" }), 150, "no-show from before the terms snapshot: as requestRefund (nothing kept)");
  assert.equal(amount({ payAtHospital: true, amountPaid: 0 }), 0, "pay at the hospital: nothing paid");
});
