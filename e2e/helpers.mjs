// Shared helpers for the end-to-end tests. Everything here talks only to
// the local emulators (FIRESTORE_EMULATOR_HOST etc. are set by
// `firebase emulators:exec`) and refuses to run otherwise.
import { createRequire } from "node:module";

const PROJECT = process.env.GCLOUD_PROJECT || "demo-telemedicine";
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST || !PROJECT.startsWith("demo-")) {
  throw new Error("End-to-end tests run only on the emulators: use `npm run test:e2e`.");
}

// firebase-admin from the functions package (the website doesn't use it).
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
if (!getApps().length) initializeApp({ projectId: PROJECT });
export const db = getFirestore();
export const adminAuth = getAuth();
export { Timestamp };

const FUNCTIONS = `http://127.0.0.1:5001/${PROJECT}/europe-west1`;

/** A unique email for a test run. */
export const uniqueEmail = (who) => `${who}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.test`;
// deepcode ignore NoHardcodedPasswords: password of throwaway accounts that exist only in the local emulator.
export const PASSWORD = "E2e-Test-Password-1!";

/** Marks an account's email as verified (stands in for clicking the email link). */
export async function verifyEmail(email) {
  const user = await adminAuth.getUserByEmail(email);
  await adminAuth.updateUser(user.uid, { emailVerified: true });
  return user.uid;
}

/**
 * The Paystack window, played by the robot: when the site opens it, the
 * payment "succeeds" at once and the fake Paystack (globalSetup.mjs) is
 * told what was paid, so the server's verify-by-reference finds it.
 */
export async function stubPaystack(page) {
  await page.exposeFunction("__e2eRecordPayment", async (p) => {
    await fetch("http://127.0.0.1:4599/__paid", { method: "POST", body: JSON.stringify(p) });
  });
  await page.addInitScript(() => {
    window.PaystackPop = {
      setup(cfg) {
        return {
          openIframe() {
            window
              .__e2eRecordPayment({ reference: cfg.ref, amount: cfg.amount, currency: cfg.currency, email: cfg.email })
              .then(() => cfg.callback({ reference: cfg.ref, status: "success" }));
          },
        };
      },
    };
  });
}

// ---------------------------------------------------------------- staff --
// Staff sign in with an authenticator app, which a robot can't use. On the
// emulator (which accepts unsigned tokens), the tests call the real staff
// functions with a token carrying the same claims a signed-in admin or
// doctor has after their authenticator step. This only works on the
// emulator: deployed functions verify Google's signature.

function unsignedToken(uid, claims) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    auth_time: now,
    iat: now,
    exp: now + 3600,
    sub: uid,
    user_id: uid,
    email: `${uid}@example.test`,
    email_verified: true,
    firebase: {
      identities: {},
      sign_in_provider: "password",
      sign_in_second_factor: "totp",
      second_factor_identifier: `factor-${uid}`,
    },
    ...claims,
  };
  return `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.`;
}

/** Creates an active admin or doctor profile (with its pinned authenticator). */
export async function seedStaff(role, name) {
  const uid = `${role}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await db.doc(`adminUsers/${uid}`).set({
    uid,
    role,
    name,
    email: `${uid}@example.test`,
    status: "active",
    mfaFactorUid: `factor-${uid}`,
    ...(role === "doctor" ? { department: "General OPD" } : {}),
  });
  if (role === "doctor") {
    await db.doc(`doctorProfiles/${uid}`).set({
      name,
      roleTitle: "General OPD",
      isListed: true,
      isAvailable: true,
      availableFor: ["OPD", "SURGICAL"],
      specialties: [],
    });
  }
  return { uid, role, token: unsignedToken(uid, { role }) };
}

/** Calls a deployed-in-the-emulator callable as `who` (from seedStaff). */
export async function callAs(who, name, data = {}, extraHeaders = {}) {
  const res = await fetch(`${FUNCTIONS}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${who.token}`, ...extraHeaders },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    throw new Error(`${name} failed: ${res.status} ${JSON.stringify(body.error || body)}`);
  }
  return body.result;
}

/** Waits until `check()` returns something truthy (polls the emulator). */
export async function waitFor(check, { timeout = 30000, every = 500, what = "condition" } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, every));
  }
}

/** Prints the browser's errors and failed requests into the test output. */
export function logBrowser(page) {
  // Known harmless noise: the service worker is blocked on purpose in the
  // tests, and Firestore closes its connection when a page changes.
  const noise = /Service Worker registration|Service worker registration failed/;
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type()) && !noise.test(m.text())) {
      console.log(`[browser ${m.type()}] ${m.text().slice(0, 300)}`);
    }
  });
  page.on("pageerror", (e) => console.log(`[browser exception] ${String(e).slice(0, 300)}`));
  page.on("requestfailed", (r) => {
    if (r.url().includes("/Listen/channel") && r.failure()?.errorText === "net::ERR_ABORTED") return;
    console.log(`[request failed] ${r.url().slice(0, 120)} ${r.failure()?.errorText}`);
  });
}

// -------------------------------------------------------------- patients --
const consent = require("../functions/lib/consentText.js");
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;

async function authRest(path, body) {
  const res = await fetch(`${AUTH}/${path}?key=demo-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(json.error || json)}`);
  return json;
}

/**
 * A patient account made the way the website makes one (sign-up, then
 * registerPatient), with the email already confirmed. The returned token is
 * a real emulator ID token carrying the patient role.
 */
export async function createPatient(name = "Kofi Asante") {
  const email = uniqueEmail("patient");
  const created = await authRest("accounts:signUp", { email, password: PASSWORD, returnSecureToken: true });
  await callAs({ token: created.idToken }, "registerPatient", {
    name,
    phone: "0241234567",
    acceptedTerms: true,
    ageDeclarationVersion: consent.CURRENT_AGE_DECLARATION,
  });
  await adminAuth.updateUser(created.localId, { emailVerified: true });
  const signedIn = await authRest("accounts:signInWithPassword", { email, password: PASSWORD, returnSecureToken: true });
  return { uid: created.localId, email, name, token: signedIn.idToken };
}

/** A paid video-call booking, through the same functions the booking page uses. */
export async function createPaidBooking(patient) {
  const draft = await callAs(patient, "createBookingDraft", {
    type: "OPD",
    mode: "online",
    ageYears: 34,
    sex: "male",
    town: "Berekum",
    area: "Kato",
    phone: "0241234567",
    consentVersion: consent.CURRENT_BOOKING_CONSENT,
  });
  const pay = await callAs(patient, "initializePayment", { bookingId: draft.bookingId });
  await fetch("http://127.0.0.1:4599/__paid", {
    method: "POST",
    body: JSON.stringify({ reference: pay.reference, amount: pay.amount * 100, currency: pay.currency, email: patient.email }),
  });
  await waitFor(
    async () => (await callAs(patient, "getBookingStatus", { bookingId: draft.bookingId })).status === "confirmed",
    { timeout: 30000, every: 1500, what: "the payment to be confirmed" },
  );
  return draft.bookingId;
}

/** Signs a patient in on the website's own sign-in page. */
export async function signInOnSite(page, patient) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(patient.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
}

/**
 * A scheduled video consultation `startsInMs` from now with a doctor who
 * has a registered room computer. Returns { consultationId, doctor, device }.
 */
export async function scheduleWithDoctor(bookingId, startsInMs) {
  const admin = await seedStaff("admin", "E2E Admin");
  const doctor = await seedStaff("doctor", "Dr. Kwame Boateng");
  const device = await callAs(admin, "registerRoomDevice", { label: "E2E room" });
  await callAs(admin, "scheduleConsultation", {
    bookingId,
    doctorUid: doctor.uid,
    scheduledTime: new Date(Date.now() + startsInMs).toISOString(),
  });
  const booking = (await db.doc(`bookings/${bookingId}`).get()).data();
  return { consultationId: booking.consultationId, doctor, device: { id: device.deviceId, key: device.key } };
}
