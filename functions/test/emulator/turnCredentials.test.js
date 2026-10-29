// Video relay (TURN) credentials, run against the Firestore EMULATOR (never
// the live database). Only someone in the video room gets them, so they
// can't be collected ahead of time and the hospital's relay used for
// anything else.
// Run from the repo root: npm run test:functions (needs Java 21).

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

// No request to Cloudflare: the emulator-only switch answers with no
// servers once every check has passed (consultations.js).
process.env.FUNCTIONS_EMULATOR = "true";
process.env.TURN_RELAY = "off";

const { Timestamp } = require("firebase-admin/firestore");
const { db } = require("../../lib/core");
const { getTurnCredentials, startVideoCall } = require("../../consultations");
const { CURRENT_CALL_CONSENT } = require("../../lib/consentText");

const MIN = 60 * 1000;
const ID = "HFC-TURNTEST01";
const PATIENT = "patient1";

test.beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
  assert.ok((await fetch(url, { method: "DELETE" })).ok, "emulator reset failed");
});

const asPatient = (data) => ({
  data,
  auth: { uid: PATIENT, token: { role: "patient", email_verified: true, auth_time: SIGNED_IN, email: "patient@example.test" } },
  rawRequest: { headers: {}, ip: "127.0.0.1" },
});

async function seed(startsInMs) {
  await db.doc(`users/${PATIENT}`).set({ status: "active", signInNotedAt: SIGNED_IN, name: "Test Patient", email: "patient@example.test" });
  await db.doc("adminUsers/doctor1").set({ role: "doctor", status: "active", name: "Dr Test", email: "doctor@example.test" });
  await db.doc("bookings/b-turn").set({ patientUid: PATIENT, status: "scheduled", consultationId: ID, email: "patient@example.test" });
  await db.doc(`consultations/${ID}`).set({
    bookingId: "b-turn", patientUid: PATIENT, doctorUid: "doctor1", doctorName: "Dr Test",
    type: "OPD", mode: "online", status: "scheduled", scheduledTime: Timestamp.fromMillis(Date.now() + startsInMs),
  });
}

test("no relay credentials days before the call", async () => {
  await seed(3 * 24 * 60 * MIN);
  await assert.rejects(getTurnCredentials.run(asPatient({ consultationId: ID })), /Join the video call first/);
});

test("no relay credentials before joining, even when the room is open", async () => {
  await seed(10 * MIN);
  await assert.rejects(getTurnCredentials.run(asPatient({ consultationId: ID })), /Join the video call first/);
});

test("relay credentials once the patient has joined", async () => {
  await seed(10 * MIN);
  await startVideoCall.run(asPatient({ consultationId: ID, callConsentVersion: CURRENT_CALL_CONSENT }));
  const turn = await getTurnCredentials.run(asPatient({ consultationId: ID }));
  assert.deepEqual(turn, { iceServers: [] });
});
