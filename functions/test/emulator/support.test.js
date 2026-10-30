// Support messages (functions/support.js): only the patient's own
// conversations, limits, who's emailed what, no staff uid on the
// patient-readable records, and the hourly tidy-up. Run against the
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
const { db } = require("../../lib/core");
const {
  sendSupportMessage,
  replySupportMessage,
  setSupportStatus,
  closeSupportThread,
  markSupportRead,
  supportHousekeeping,
  deletePatientThreads,
} = require("../../support");

const SIGNED_IN = Math.floor(Date.now() / 1000) - 60;
const raw = { headers: { "user-agent": "test", "x-forwarded-for": "198.51.100.7" } };
const asPatient = (data, uid = "pat1", verified = true) => ({
  data,
  auth: { uid, token: { role: "patient", email_verified: verified, auth_time: SIGNED_IN, email: `${uid}@example.test` } },
  rawRequest: raw,
});
const asAdmin = (data) => ({
  data,
  auth: {
    uid: "admin1",
    token: {
      role: "admin",
      auth_time: SIGNED_IN,
      firebase: { sign_in_second_factor: "totp", second_factor_identifier: "f1" },
    },
  },
  rawRequest: raw,
});
const mailOf = async (kind) => (await db.collection("mail").where("kind", "==", kind).get()).docs.map((d) => d.data());

test.beforeEach(async () => {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
  assert.ok((await fetch(url, { method: "DELETE" })).ok, "emulator reset failed");
  await db.doc("users/pat1").set({ status: "active", name: "Ama Mensah", email: "pat1@example.test", signInNotedAt: SIGNED_IN });
  await db.doc("users/pat2").set({ status: "active", name: "Kofi", email: "pat2@example.test", signInNotedAt: SIGNED_IN });
  await db.doc("adminUsers/admin1").set({ role: "admin", status: "active", email: "admin@example.test", mfaFactorUid: "f1" });
  await db.doc("bookings/b1").set({ patientUid: "pat1", status: "scheduled", consultationId: "HFC-AAAAAAAAAA", type: "OPD", mode: "online" });
  await db.doc("bookings/b2").set({ patientUid: "pat2", status: "scheduled", consultationId: "HFC-BBBBBBBBBB", type: "OPD", mode: "online" });
});

test("a patient starts a conversation; admins are emailed without the text", async () => {
  const { threadId } = await sendSupportMessage.run(asPatient({ topic: "payment", bookingId: "b1", text: "Where is my refund?" }));
  const thread = (await db.doc(`supportThreads/${threadId}`).get()).data();
  assert.equal(thread.patientUid, "pat1");
  assert.equal(thread.status, "waiting");
  assert.equal(thread.booking.consultationId, "HFC-AAAAAAAAAA");
  const [toAdmin] = await mailOf("admin_support_message");
  assert.equal(toAdmin.to, "admin@example.test");
  assert.equal(JSON.stringify(toAdmin.data).includes("refund?"), false);
  assert.equal(JSON.stringify(toAdmin.data).includes("Ama"), false);
  // A second message while it's still waiting: no second admin email.
  await sendSupportMessage.run(asPatient({ threadId, text: "Hello?" }));
  assert.equal((await mailOf("admin_support_message")).length, 1);
});

test("an unverified email, someone else's booking or conversation is refused", async () => {
  await assert.rejects(sendSupportMessage.run(asPatient({ topic: "other", text: "Hi there" }, "pat1", false)));
  await assert.rejects(sendSupportMessage.run(asPatient({ topic: "booking", bookingId: "b2", text: "Hi there" })));
  const { threadId } = await sendSupportMessage.run(asPatient({ topic: "other", text: "Hi there" }, "pat2"));
  await assert.rejects(sendSupportMessage.run(asPatient({ threadId, text: "Let me in" })), { code: "not-found" });
  await assert.rejects(closeSupportThread.run(asPatient({ threadId })), { code: "not-found" });
  await assert.rejects(markSupportRead.run(asPatient({ threadId })), { code: "not-found" });
});

test("at most three open conversations", async () => {
  for (let i = 0; i < 3; i++) await sendSupportMessage.run(asPatient({ topic: "other", text: `Question ${i}` }));
  await assert.rejects(sendSupportMessage.run(asPatient({ topic: "other", text: "One more" })), { code: "failed-precondition" });
});

test("an admin reply: patient emailed the text, unread badge, admin kept off the thread", async () => {
  const { threadId } = await sendSupportMessage.run(asPatient({ topic: "account", text: "Can't change my name" }));
  await db.doc("users/pat1").update({ email: "new@example.test" });
  await replySupportMessage.run(asAdmin({ threadId, text: "Fixed it for you." }));

  const thread = (await db.doc(`supportThreads/${threadId}`).get()).data();
  assert.equal(thread.status, "answered");
  assert.equal(thread.unreadByPatient, true);
  assert.equal(JSON.stringify(thread).includes("admin1"), false);
  const messages = await db.collection(`supportThreads/${threadId}/messages`).get();
  assert.equal(messages.docs.some((m) => JSON.stringify(m.data()).includes("admin1")), false);
  const staff = (await db.doc(`supportStaff/${threadId}`).get()).data();
  assert.equal(staff.handledBy.uid, "admin1");
  assert.ok(Object.values(staff.replies).includes("admin1"));

  const [reply] = await mailOf("support_reply");
  assert.equal(reply.to, "new@example.test"); // the current address
  assert.equal(reply.data.reply, "Fixed it for you.");

  await markSupportRead.run(asPatient({ threadId }));
  assert.equal((await db.doc(`supportThreads/${threadId}`).get()).data().unreadByPatient, false);
});

test("closing, reopening, auto-close and deletion after 30 days", async () => {
  const { threadId } = await sendSupportMessage.run(asPatient({ topic: "other", text: "First" }));
  await replySupportMessage.run(asAdmin({ threadId, text: "Answer" }));
  // Answered 8 days ago and nothing since: closed by the hourly task.
  await db.doc(`supportThreads/${threadId}`).update({ answeredAt: Timestamp.fromMillis(Date.now() - 8 * 86400000) });
  await supportHousekeeping();
  const closed = (await db.doc(`supportThreads/${threadId}`).get()).data();
  assert.equal(closed.status, "closed");
  assert.ok(closed.deleteAt.toMillis() > Date.now() + 29 * 86400000);

  // Writing again reopens it (and the admins hear about it again).
  await sendSupportMessage.run(asPatient({ threadId, text: "Still stuck" }));
  assert.equal((await db.doc(`supportThreads/${threadId}`).get()).data().status, "waiting");
  assert.equal((await mailOf("admin_support_message")).length, 2);

  await closeSupportThread.run(asPatient({ threadId }));
  await db.doc(`supportThreads/${threadId}`).update({ deleteAt: Timestamp.fromMillis(Date.now() - 1000) });
  await supportHousekeeping();
  assert.equal((await db.doc(`supportThreads/${threadId}`).get()).exists, false);
  assert.equal((await db.collection(`supportThreads/${threadId}/messages`).get()).size, 0);
  assert.equal((await db.doc(`supportStaff/${threadId}`).get()).exists, false);
});

test("a deleted account's conversations go with it", async () => {
  await sendSupportMessage.run(asPatient({ topic: "other", text: "Mine" }));
  const { threadId: other } = await sendSupportMessage.run(asPatient({ topic: "other", text: "Theirs" }, "pat2"));
  assert.equal(await deletePatientThreads("pat1"), 1);
  assert.equal((await db.collection("supportThreads").where("patientUid", "==", "pat1").get()).size, 0);
  assert.equal((await db.doc(`supportThreads/${other}`).get()).exists, true);
});

const statusOf = async (id) => (await db.doc(`supportThreads/${id}`).get()).data().status;

test("'No reply needed' answers a patient's 'ok' without emailing them", async () => {
  const { threadId } = await sendSupportMessage.run(asPatient({ topic: "payment", text: "Is my payment through?" }));
  await replySupportMessage.run(asAdmin({ threadId, text: "We're checking, we'll get back to you." }));
  await sendSupportMessage.run(asPatient({ threadId, text: "ok" }));
  assert.equal(await statusOf(threadId), "waiting");

  await setSupportStatus.run(asAdmin({ threadId, status: "answered" }));
  assert.equal(await statusOf(threadId), "answered");
  assert.equal((await mailOf("support_reply")).length, 1); // only the real reply
  const audits = await db.collection("auditLog").where("code", "==", "support.no_reply_needed").get();
  assert.equal(audits.size, 1);

  // Auto-close counts from when it was marked, not from the patient's "ok".
  await db.doc(`supportThreads/${threadId}`).update({ lastMessageAt: Timestamp.fromMillis(Date.now() - 30 * 86400000) });
  await supportHousekeeping();
  assert.equal(await statusOf(threadId), "answered");
});

test("'Needs follow-up' keeps a holding reply from being closed automatically", async () => {
  const { threadId } = await sendSupportMessage.run(asPatient({ topic: "payment", text: "Refund please" }));
  await replySupportMessage.run(asAdmin({ threadId, text: "We'll get back to you." }));
  await setSupportStatus.run(asAdmin({ threadId, status: "waiting" }));
  assert.equal(await statusOf(threadId), "waiting");
  await db.doc(`supportThreads/${threadId}`).update({ answeredAt: Timestamp.fromMillis(Date.now() - 8 * 86400000) });
  await supportHousekeeping();
  assert.equal(await statusOf(threadId), "waiting");
});

test("send and close; reopen; a closed one can't be marked as needing no reply", async () => {
  const { threadId } = await sendSupportMessage.run(asPatient({ topic: "payment", text: "Refund please" }));
  await replySupportMessage.run(asAdmin({ threadId, text: "Your refund has been sent.", close: true }));
  const thread = (await db.doc(`supportThreads/${threadId}`).get()).data();
  assert.equal(thread.status, "closed");
  assert.equal(thread.unreadByPatient, true);
  assert.ok(thread.deleteAt);
  const [reply] = await mailOf("support_reply");
  assert.equal(reply.data.closed, true);

  await assert.rejects(setSupportStatus.run(asAdmin({ threadId, status: "answered" })), { code: "failed-precondition" });
  await assert.rejects(setSupportStatus.run(asAdmin({ threadId, status: "closed" })), { code: "invalid-argument" });
  await setSupportStatus.run(asAdmin({ threadId, status: "waiting" }));
  const reopened = (await db.doc(`supportThreads/${threadId}`).get()).data();
  assert.equal(reopened.status, "waiting");
  assert.equal(reopened.deleteAt, undefined);
});

test("a patient closes a conversation still waiting; patients can't change the status", async () => {
  const { threadId } = await sendSupportMessage.run(asPatient({ topic: "account", text: "Can't sign in" }));
  await assert.rejects(setSupportStatus.run(asPatient({ threadId, status: "answered" })), { code: "permission-denied" });
  await closeSupportThread.run(asPatient({ threadId }));
  assert.equal(await statusOf(threadId), "closed");
});
