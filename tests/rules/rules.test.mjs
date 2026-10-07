// Security Rules tests (Firestore and Storage), run on the local emulators
// against a throwaway demo project — never the real one:
//
//   npm run test:rules
//
// They pin down the behaviour the app's security depends on: staff need
// their pinned authenticator (and a sign-in under 12 hours old), patients
// must be active and see only their own data, clients can't write
// server-owned collections, and call signalling is limited to the two
// participants. Add a test whenever a rule changes.

import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";

const PROJECT_ID = "demo-telemedicine";
const now = () => Math.floor(Date.now() / 1000);

let env;

/* ---------------- identities ---------------- */

const FACTOR = "factor-pinned";

function staff(uid, role, { factor = FACTOR, ageHours = 1, secondFactor = true } = {}) {
  return env
    .authenticatedContext(uid, {
      role,
      email: `${uid}@hospital.test`,
      email_verified: true,
      auth_time: now() - ageHours * 3600,
      firebase: secondFactor
        ? { sign_in_provider: "password", sign_in_second_factor: "totp", second_factor_identifier: factor }
        : { sign_in_provider: "password" },
    });
}
const admin = (opts) => staff("admin1", "admin", opts);
const doctor = (opts) => staff("doc1", "doctor", opts);
const otherDoctor = () => staff("doc2", "doctor");
const patient = (uid = "pat1") =>
  env.authenticatedContext(uid, { role: "patient", email_verified: true, auth_time: now() });

/* ---------------- setup ---------------- */

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
    storage: { rules: readFileSync("storage.rules", "utf8") },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const put = (path, data) => setDoc(doc(db, path), data);
    await put("adminUsers/admin1", { role: "admin", status: "active", mfaFactorUid: FACTOR });
    await put("adminUsers/doc1", { role: "doctor", status: "active", mfaFactorUid: FACTOR });
    await put("adminUsers/doc2", { role: "doctor", status: "active", mfaFactorUid: FACTOR });
    await put("adminUsers/docNew", { role: "doctor", status: "active" }); // no authenticator pinned
    await put("users/pat1", { status: "active" });
    await put("users/pat2", { status: "active" });
    await put("users/patOff", { status: "deactivated" });
    await put("bookings/b1", { patientUid: "pat1", status: "scheduled" });
    await put("bookings/b2", { patientUid: "pat2", status: "scheduled" });
    await put("bookings/bOff", { patientUid: "patOff", status: "scheduled" });
    await put("consultations/c1", { doctorUid: "doc1", patientUid: "pat1", status: "scheduled" });
    await put("calls/c1", { doctorUid: "doc1", patientUid: "pat1", patientSeq: 1 });
    await put("availableSlots/open1", { status: "open", doctorName: "Dr A" });
    await put("availableSlots/held1", { status: "held", heldByUid: "pat2" });
    await put("auditLog/a1", { code: "x" });
    await put("deletionRequests/r1", { status: "pending" });
    await put("accessRequests/q1", { status: "pending", purpose: "play" });
    await put("bookingLog/b1", { type: "OPD", mode: "online" });
    await put("rateLimits/x_pat1", { count: 1 });
    await put("mail/m1", { to: "x@y.z" });
    await put("recordings/rec1", { doctorUid: "doc1", status: "recording" });
    await put("doctorProfiles/doc1", {
      name: "Dr One", bio: "", focus: "", specialties: [], languages: [], isAvailable: true, photoURL: null,
    });
  });
});

const get = (ctx, path) => getDoc(doc(ctx.firestore(), path));

/* ---------------- staff second factor ---------------- */

describe("admins need their pinned authenticator", () => {
  test("pinned TOTP sign-in can read the audit log", async () => {
    await assertSucceeds(get(admin(), "auditLog/a1"));
  });
  test("password-only sign-in is refused", async () => {
    await assertFails(get(admin({ secondFactor: false }), "auditLog/a1"));
  });
  test("a different (unpinned) authenticator is refused", async () => {
    await assertFails(get(admin({ factor: "stranger-factor" }), "auditLog/a1"));
  });
  test("a sign-in older than 12 hours is refused", async () => {
    await assertFails(get(admin({ ageHours: 13 }), "auditLog/a1"));
  });
  test("a deactivated admin is refused", async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      updateDoc(doc(ctx.firestore(), "adminUsers/admin1"), { status: "deactivated" }));
    await assertFails(get(admin(), "auditLog/a1"));
  });
});

describe("staff read their own profile (the sign-in page needs this)", () => {
  test("admin right after the authenticator step", async () => {
    await assertSucceeds(get(admin(), "adminUsers/admin1"));
  });
  test("admin before setting up an authenticator", async () => {
    await assertSucceeds(get(admin({ secondFactor: false }), "adminUsers/admin1"));
  });
  test("doctor reads their own, not another's", async () => {
    await assertSucceeds(get(doctor({ secondFactor: false }), "adminUsers/doc1"));
    await assertFails(get(doctor({ secondFactor: false }), "adminUsers/doc2"));
  });
});

describe("doctors need their pinned authenticator", () => {
  test("pinned TOTP doctor reads their own consultation", async () => {
    await assertSucceeds(get(doctor(), "consultations/c1"));
  });
  test("password-only doctor is refused", async () => {
    await assertFails(get(doctor({ secondFactor: false }), "consultations/c1"));
  });
  test("doctor without a pinned authenticator is refused", async () => {
    await assertFails(get(staff("docNew", "doctor"), "consultations/c1"));
  });
  test("another doctor can't read it", async () => {
    await assertFails(get(otherDoctor(), "consultations/c1"));
  });
  test("doctors can't read the audit log", async () => {
    await assertFails(get(doctor(), "auditLog/a1"));
  });
});

/* ---------------- patients ---------------- */

describe("patients", () => {
  test("read their own booking", async () => {
    await assertSucceeds(get(patient("pat1"), "bookings/b1"));
  });
  test("can't read someone else's booking", async () => {
    await assertFails(get(patient("pat1"), "bookings/b2"));
  });
  test("deactivated patients can't read their bookings", async () => {
    await assertFails(get(patient("patOff"), "bookings/bOff"));
  });
  test("deactivated patients can still read their own profile (to learn they're deactivated)", async () => {
    await assertSucceeds(get(patient("patOff"), "users/patOff"));
  });
  test("can't write bookings directly", async () => {
    await assertFails(setDoc(doc(patient("pat1").firestore(), "bookings/new"), { patientUid: "pat1" }));
  });
});

/* ---------------- server-only and admin-only data ---------------- */

describe("server-owned collections", () => {
  test("even an admin can't write bookings, audit log or deletion requests", async () => {
    const db = admin().firestore();
    await assertFails(setDoc(doc(db, "bookings/x"), { a: 1 }));
    await assertFails(setDoc(doc(db, "auditLog/x"), { a: 1 }));
    await assertFails(updateDoc(doc(db, "deletionRequests/r1"), { status: "approved" }));
  });
  test("deletion requests: admins read, doctors don't", async () => {
    await assertSucceeds(get(admin(), "deletionRequests/r1"));
    await assertFails(get(doctor(), "deletionRequests/r1"));
  });
  test("booking log: admins read only; nobody writes", async () => {
    await assertSucceeds(get(admin(), "bookingLog/b1"));
    await assertFails(get(doctor(), "bookingLog/b1"));
    await assertFails(get(patient("pat1"), "bookingLog/b1"));
    await assertFails(setDoc(doc(admin().firestore(), "bookingLog/b2"), { type: "OPD" }));
  });
  test("recording access requests: admins read only; nobody writes", async () => {
    await assertSucceeds(get(admin(), "accessRequests/q1"));
    await assertFails(get(doctor(), "accessRequests/q1"));
    await assertFails(get(patient("pat1"), "accessRequests/q1"));
    await assertFails(updateDoc(doc(admin().firestore(), "accessRequests/q1"), { status: "approved" }));
    await assertFails(setDoc(doc(admin().firestore(), "accessRequests/q2"), { status: "approved" }));
  });
  test("rate limits and the mail outbox are closed to everyone", async () => {
    await assertFails(get(admin(), "rateLimits/x_pat1"));
    await assertFails(get(patient("pat1"), "rateLimits/x_pat1"));
    await assertFails(get(admin(), "mail/m1"));
  });
});

describe("public data", () => {
  test("anyone can read an open slot", async () => {
    await assertSucceeds(get(env.unauthenticatedContext(), "availableSlots/open1"));
  });
  test("held slots aren't public", async () => {
    await assertFails(get(env.unauthenticatedContext(), "availableSlots/held1"));
  });
});

/* ---------------- call signalling ---------------- */

describe("call signalling", () => {
  test("verified doctor writes the offer", async () => {
    await assertSucceeds(updateDoc(doc(doctor().firestore(), "calls/c1"), { offer: { type: "offer", sdp: "v=0", id: "o1", seq: 1 } }));
  });
  test("password-only doctor can't", async () => {
    await assertFails(updateDoc(doc(doctor({ secondFactor: false }).firestore(), "calls/c1"), { offer: { type: "offer", sdp: "v=0", id: "o1", seq: 1 } }));
  });
  test("patient writes the answer, not the offer", async () => {
    const db = patient("pat1").firestore();
    await assertSucceeds(updateDoc(doc(db, "calls/c1"), { answer: { type: "answer", sdp: "v=0", id: "a1", offerId: "o1" } }));
    await assertFails(updateDoc(doc(db, "calls/c1"), { offer: { type: "offer", sdp: "v=0", id: "o2", seq: 2 } }));
  });
  test("an outsider can't read the call", async () => {
    await assertFails(get(patient("pat2"), "calls/c1"));
  });
});

describe("doctor profile edits", () => {
  test("verified doctor edits their own presentational fields", async () => {
    await assertSucceeds(updateDoc(doc(doctor().firestore(), "doctorProfiles/doc1"), {
      bio: "Hello", updatedAt: serverTimestamp(),
    }));
  });
  test("password-only doctor can't edit", async () => {
    await assertFails(updateDoc(doc(doctor({ secondFactor: false }).firestore(), "doctorProfiles/doc1"), {
      bio: "x", updatedAt: serverTimestamp(),
    }));
  });
  test("a doctor can't change their own listing or name", async () => {
    await assertFails(updateDoc(doc(doctor().firestore(), "doctorProfiles/doc1"), {
      name: "Someone else", updatedAt: serverTimestamp(),
    }));
  });
});

/* ---------------- storage ---------------- */

describe("storage", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);

  test("verified admin uploads a site image; password-only admin can't", async () => {
    await assertSucceeds(uploadBytes(ref(admin().storage(), "siteAssets/hero/a.jpg"), jpeg, { contentType: "image/jpeg" }));
    await assertFails(uploadBytes(ref(admin({ secondFactor: false }).storage(), "siteAssets/hero/b.jpg"), jpeg, { contentType: "image/jpeg" }));
  });
  test("verified doctor uploads a recording part; password-only doctor can't", async () => {
    await assertSucceeds(uploadBytes(ref(doctor().storage(), "recordings/rec1/parts/000001.webm"), webm, { contentType: "video/webm" }));
    await assertFails(uploadBytes(ref(doctor({ secondFactor: false }).storage(), "recordings/rec1/parts/000002.webm"), webm, { contentType: "video/webm" }));
  });
  test("patients can't upload recordings", async () => {
    await assertFails(uploadBytes(ref(patient("pat1").storage(), "recordings/rec1/parts/000003.webm"), webm, { contentType: "video/webm" }));
  });
});
