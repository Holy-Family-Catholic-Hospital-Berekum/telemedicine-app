// A patient's sign-in must be reported before the account can be used
// (accounts.js noteSignIn, lib/core.js requireRole), and reporting it from
// a browser the account hasn't used emails the holder, so a stolen
// password can't be used without them hearing of it. Run against the
// Firestore EMULATOR (never the live database).
// Run from the repo root: npm run test:functions (needs Java 21).

const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("These tests need the Firestore emulator: run `npm run test:functions` from the repo root.");
}
const PROJECT = process.env.GCLOUD_PROJECT || "demo-telemedicine";
if (!PROJECT.startsWith("demo-")) throw new Error("Refusing to run against a non-demo project.");

const { Timestamp } = require("firebase-admin/firestore");
const { db, sha256 } = require("../../lib/core");
const { noteSignIn, updatePatientProfile } = require("../../accounts");

const PATIENT = "patient1";
const KNOWN_DEVICE = "known-browser-0123456789";
const SIGNED_IN = Math.floor(Date.now() / 1000) - 60;

test.beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
  assert.ok((await fetch(url, { method: "DELETE" })).ok, "emulator reset failed");
  // An account that has signed in before, from one browser, and reported
  // an earlier sign-in.
  await db.doc(`users/${PATIENT}`).set({
    status: "active",
    name: "Test Patient",
    email: "patient@example.test",
    signInNotedAt: SIGNED_IN - 3600,
    knownDevices: { [sha256(`${PATIENT}:${KNOWN_DEVICE}`).slice(0, 32)]: Timestamp.now() },
  });
});

const asPatient = (data, authTime = SIGNED_IN) => ({
  data,
  auth: { uid: PATIENT, token: { role: "patient", email_verified: true, auth_time: authTime, email: "patient@example.test" } },
  rawRequest: { headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/130.0" }, ip: "127.0.0.1" },
});
const alerts = async () =>
  (await db.collection("mail").where("kind", "==", "security_new_sign_in").get()).size;

test("a sign-in that wasn't reported can't use the account", async () => {
  await assert.rejects(
    updatePatientProfile.run(asPatient({ name: "New Name" })),
    (err) => err.details?.reason === "sign_in_unreported",
  );
});

test("reporting from a new browser emails the holder and unlocks this sign-in", async () => {
  await noteSignIn.run(asPatient({ deviceId: "stolen-password-browser-01" }));
  assert.equal(await alerts(), 1);
  assert.equal((await db.doc(`users/${PATIENT}`).get()).data().signInNotedAt, SIGNED_IN);
  await updatePatientProfile.run(asPatient({ name: "New Name" }));
});

test("reporting without a device id still emails the holder", async () => {
  await noteSignIn.run(asPatient({}));
  assert.equal(await alerts(), 1);
  await updatePatientProfile.run(asPatient({ name: "New Name" }));
});

test("a known browser unlocks the sign-in without an email; reporting it again does nothing", async () => {
  await noteSignIn.run(asPatient({ deviceId: KNOWN_DEVICE }));
  await noteSignIn.run(asPatient({ deviceId: "another-browser-000000001" }));
  assert.equal(await alerts(), 0);
  await updatePatientProfile.run(asPatient({ name: "New Name" }));
});
