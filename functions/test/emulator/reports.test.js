// Metrics report downloads need a second admin (reports.js), against the
// Firestore EMULATOR. Run from the repo root: npm run test:functions.

const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("These tests need the Firestore emulator: run `npm run test:functions` from the repo root.");
}
const PROJECT = process.env.GCLOUD_PROJECT || "demo-telemedicine";
if (!PROJECT.startsWith("demo-")) throw new Error("Refusing to run against a non-demo project.");

const { db } = require("../../lib/core");
const { exportMetrics, cancelReportRequest, decideReportRequest, downloadReport } = require("../../reports");

async function clearFirestore() {
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
  assert.ok((await fetch(url, { method: "DELETE" })).ok);
}

/** An active admin who has passed their authenticator step. */
async function admin(uid) {
  await db.doc(`adminUsers/${uid}`).set({ role: "admin", status: "active", name: uid, mfaFactorUid: `f-${uid}` });
  return (data) => ({
    data,
    auth: {
      uid,
      token: {
        role: "admin",
        auth_time: Math.floor(Date.now() / 1000),
        firebase: { sign_in_second_factor: "totp", second_factor_identifier: `f-${uid}` },
      },
    },
    rawRequest: { headers: {}, ip: "127.0.0.1" },
  });
}

const OCT = { from: "2026-10-01", to: "2026-10-31", label: "October 2026" };

test.beforeEach(clearFirestore);

test("one admin prepares and views; the report data isn't stored where admins can read it", async () => {
  const ama = await admin("ama");
  const res = await exportMetrics.run(ama(OCT));
  assert.ok(res.requestId);
  assert.ok(Array.isArray(res.tables) && res.tables.length > 0); // viewable
  const r = (await db.doc(`reportRequests/${res.requestId}`).get()).data();
  assert.equal(r.status, "pending");
  assert.equal(r.report, undefined); // only in reportData (no browser access)
  assert.ok((await db.doc(`reportData/${res.requestId}`).get()).exists);
});

test("download needs another admin's approval, then works once", async () => {
  const ama = await admin("ama");
  const kofi = await admin("kofi");
  const { requestId } = await exportMetrics.run(ama(OCT));

  await assert.rejects(downloadReport.run(ama({ requestId })), /hasn't approved/);
  await assert.rejects(decideReportRequest.run(ama({ requestId, decision: "approve" })), /Another admin/);
  await decideReportRequest.run(kofi({ requestId, decision: "approve" }));
  await assert.rejects(downloadReport.run(kofi({ requestId })), /Only the admin who prepared/);

  const report = await downloadReport.run(ama({ requestId }));
  assert.equal(report.label, "October 2026");
  assert.ok(report.tables.length > 0);
  assert.equal((await db.doc(`reportRequests/${requestId}`).get()).data().status, "downloaded");
  assert.equal((await db.doc(`reportData/${requestId}`).get()).exists, false);
  await assert.rejects(downloadReport.run(ama({ requestId })), /closed/);
});

test("a rejected report can't be downloaded; the data is deleted", async () => {
  const ama = await admin("ama");
  const kofi = await admin("kofi");
  const { requestId } = await exportMetrics.run(ama(OCT));
  await decideReportRequest.run(kofi({ requestId, decision: "reject" }));
  await assert.rejects(downloadReport.run(ama({ requestId })), /closed/);
  assert.equal((await db.doc(`reportData/${requestId}`).get()).exists, false);
});

test("the admin who prepared it can cancel; nobody else can", async () => {
  const ama = await admin("ama");
  const kofi = await admin("kofi");
  const { requestId } = await exportMetrics.run(ama(OCT));
  await assert.rejects(cancelReportRequest.run(kofi({ requestId })), /Only the admin who prepared/);
  await cancelReportRequest.run(ama({ requestId }));
  assert.equal((await db.doc(`reportRequests/${requestId}`).get()).data().status, "cancelled");
  assert.equal((await db.doc(`reportData/${requestId}`).get()).exists, false);
  await assert.rejects(decideReportRequest.run(kofi({ requestId, decision: "approve" })), /already been handled/);
});

test("preparing a new report replaces the admin's open one", async () => {
  const ama = await admin("ama");
  const first = await exportMetrics.run(ama(OCT));
  const second = await exportMetrics.run(ama({ ...OCT, label: "October again" }));
  assert.equal((await db.doc(`reportRequests/${first.requestId}`).get()).data().status, "replaced");
  assert.equal((await db.doc(`reportRequests/${second.requestId}`).get()).data().status, "pending");
});
