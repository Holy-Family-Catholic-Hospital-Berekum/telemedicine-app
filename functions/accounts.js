// functions/accounts.js
//
// Account lifecycle. The `role` custom claim is set here and nowhere else.
//
//   registerPatient     patient finishes sign-up (profile, claim, consent,
//                       adult age declaration)
//   updatePatientProfile patient changes their name (dashboard Settings)
//   syncAccountEmail    copies a patient's newly verified sign-in email to
//                       their profile and open bookings
//   createDoctorAccount admin creates a doctor (Auth user, claim, profiles)
//   setAccountStatus    admin deactivates or reactivates a patient/doctor
//
// Accounts are never hard-deleted from the app: deactivation disables the
// Auth user and revokes its sessions, which is reversible and keeps history
// and recordings resolving to a real person.

const {
  onCall,
  admin,
  db,
  serverTime,
  TYPES,
  HttpsError,
  requireRole,
  requestMeta,
  str,
  docId,
  phoneE164,
  audit,
  rateLimit,
  sha256,
} = require("./lib/core");
const { AGE_DECLARATION_TEXT, CURRENT_AGE_DECLARATION } = require("./lib/consentText");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function legalVersion(id) {
  const snap = await db.collection("legalDocs").doc(id).get();
  // 0 = the built-in default text bundled with the app.
  return snap.exists ? snap.data().version || 0 : 0;
}

/* ------------------------------------------------------------------ */
/* registerPatient                                                     */
/* ------------------------------------------------------------------ */

/**
 * data: { name, phone, acceptedTerms: true, ageDeclarationVersion }
 * Accounts are for adults only: the patient declares they are 18 or older
 * (versioned text, stored as its own consent record). Children are booked
 * by a parent or guardian from the adult's account, with a guardian
 * consent per booking (payments.js createBookingDraft).
 * Called right after createUserWithEmailAndPassword. Idempotent: calling
 * again for an already-registered patient just re-asserts the claim.
 */
exports.registerPatient = onCall(async (request) => {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Please sign in to continue.");
  }
  const uid = auth.uid;
  const existingRole = auth.token.role;
  if (existingRole && existingRole !== "patient") {
    throw new HttpsError("failed-precondition", "This account already exists.");
  }

  await rateLimit(uid, "registerPatient", { max: 5, windowSeconds: 3600 });

  const staffSnap = await db.collection("adminUsers").doc(uid).get();
  if (staffSnap.exists) {
    throw new HttpsError("failed-precondition", "This account already exists.");
  }

  const userRef = db.collection("users").doc(uid);
  const existing = await userRef.get();

  if (!existing.exists) {
    const d = request.data || {};
    const name = str(d.name, { field: "Full name", max: 100, min: 2 });
    const phone = phoneE164(d.phone);
    if (d.acceptedTerms !== true) {
      throw new HttpsError(
        "failed-precondition",
        "Please accept the terms and privacy policy to continue.",
      );
    }
    if (d.ageDeclarationVersion !== CURRENT_AGE_DECLARATION) {
      throw new HttpsError(
        "failed-precondition",
        "Please confirm that you are 18 or older to create an account.",
      );
    }
    const email = String(auth.token.email || "").toLowerCase();
    if (!email) {
      throw new HttpsError("failed-precondition", "An email address is required.");
    }

    const [termsVersion, privacyVersion] = await Promise.all([
      legalVersion("terms"),
      legalVersion("privacy"),
    ]);
    const meta = requestMeta(request);

    const batch = db.batch();
    batch.set(userRef, {
      uid,
      name,
      email,
      phone,
      status: "active",
      createdAt: serverTime(),
      updatedAt: serverTime(),
    });
    batch.set(db.collection("consents").doc(), {
      subjectUid: uid,
      consentType: "terms_and_privacy",
      action: "granted",
      context: "signup",
      documentVersions: { terms: termsVersion, privacy: privacyVersion },
      at: serverTime(),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    batch.set(db.collection("consents").doc(), {
      subjectUid: uid,
      consentType: "age_declaration",
      action: "granted",
      context: "signup",
      version: CURRENT_AGE_DECLARATION,
      textSha256: sha256(AGE_DECLARATION_TEXT[CURRENT_AGE_DECLARATION]),
      at: serverTime(),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    audit(batch, {
      actorId: uid,
      actorRole: "patient",
      action: "Registered a patient account",
      code: "account.registered",
      category: "account",
      targetType: "user",
      targetId: uid,
      patientUid: uid,
      meta,
    });
    await batch.commit();
  } else if (existing.data().status !== "active") {
    throw new HttpsError(
      "permission-denied",
      "This account is not active. Please contact the hospital.",
    );
  }

  if (existingRole !== "patient") {
    await admin.auth().setCustomUserClaims(uid, { role: "patient" });
  }
  return { ok: true };
});

/* ------------------------------------------------------------------ */
/* patient settings                                                    */
/* ------------------------------------------------------------------ */

/**
 * data: { name }. The new name applies to the account and future
 * bookings; bookings already made keep the name they were made with.
 */
exports.updatePatientProfile = onCall(async (request) => {
  const caller = await requireRole(request, ["patient"]);
  const name = str(request.data?.name, { field: "Full name", max: 100, min: 2 });
  await rateLimit(caller.uid, "updatePatientProfile", { max: 10, windowSeconds: 86400 });

  const batch = db.batch();
  batch.update(db.collection("users").doc(caller.uid), { name, updatedAt: serverTime() });
  audit(batch, {
    actorId: caller.uid,
    actorRole: "patient",
    action: "Changed their name",
    code: "account.name_changed",
    category: "account",
    targetType: "user",
    targetId: caller.uid,
    patientUid: caller.uid,
    meta: requestMeta(request),
  });
  await batch.commit();
  await admin.auth().updateUser(caller.uid, { displayName: name }).catch(() => {});
  return { ok: true, name };
});

/**
 * No data. A patient changes their sign-in email in the browser
 * (verifyBeforeUpdateEmail: the change happens only once they click the
 * link sent to the new address). After that, this copies the verified
 * address from their ID token to the profile and to bookings still in
 * progress, so appointment emails go to the new address.
 */
exports.syncAccountEmail = onCall(async (request) => {
  const caller = await requireRole(request, ["patient"]);
  const email = String(caller.token.email || "").toLowerCase();
  if (!email || caller.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Your new email address isn't verified yet.");
  }
  if (email === String(caller.profile.email || "").toLowerCase()) {
    return { changed: false };
  }
  await rateLimit(caller.uid, "syncAccountEmail", { max: 10, windowSeconds: 86400 });

  const open = await db
    .collection("bookings")
    .where("patientUid", "==", caller.uid)
    .where("status", "in", ["awaiting_payment", "paid", "scheduled"])
    .get();
  const batch = db.batch();
  batch.update(db.collection("users").doc(caller.uid), { email, updatedAt: serverTime() });
  open.docs.forEach((d) => batch.update(d.ref, { email }));
  audit(batch, {
    actorId: caller.uid,
    actorRole: "patient",
    action: "Changed their email address",
    code: "account.email_changed",
    category: "account",
    targetType: "user",
    targetId: caller.uid,
    patientUid: caller.uid,
    meta: requestMeta(request),
  });
  await batch.commit();
  return { changed: true, email };
});

/* ------------------------------------------------------------------ */
/* createDoctorAccount                                                 */
/* ------------------------------------------------------------------ */

/**
 * data: { name, email, phone, department, availableFor: ["OPD", "SURGICAL"] }
 * Creates a password-less Auth user. The admin's browser then sends the
 * doctor Firebase's password-reset email, which is how they set their
 * own password; no password ever passes through the admin.
 */
exports.createDoctorAccount = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const d = request.data || {};

  const name = str(d.name, { field: "Name", max: 100, min: 2 });
  const email = str(d.email, { field: "Email", max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new HttpsError("invalid-argument", "Enter a valid email address.");
  }
  const phone = phoneE164(d.phone);
  const department = str(d.department, { field: "Specialty", max: 80 });
  const availableFor = Array.isArray(d.availableFor)
    ? [...new Set(d.availableFor)].filter((t) => TYPES.includes(t))
    : [];
  if (availableFor.length === 0) {
    throw new HttpsError(
      "invalid-argument",
      "Choose at least one consultation type this doctor takes.",
    );
  }

  let user;
  try {
    user = await admin.auth().createUser({
      email,
      displayName: name,
      emailVerified: false,
      disabled: false,
    });
  } catch (err) {
    if (err?.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "An account with this email already exists.");
    }
    throw err;
  }

  try {
    await admin.auth().setCustomUserClaims(user.uid, { role: "doctor" });

    const batch = db.batch();
    batch.set(db.collection("adminUsers").doc(user.uid), {
      uid: user.uid,
      role: "doctor",
      name,
      email,
      phone,
      department,
      status: "active",
      createdAt: serverTime(),
      createdByUid: caller.uid,
      updatedAt: serverTime(),
    });
    batch.set(db.collection("doctorProfiles").doc(user.uid), {
      doctorUid: user.uid,
      name,
      roleTitle: department,
      availableFor,
      specialties: [],
      languages: [],
      focus: "",
      bio: "",
      photoURL: null,
      isListed: true,
      isAvailable: true,
      updatedAt: serverTime(),
    });
    audit(batch, {
      actorId: caller.uid,
      actorRole: "admin",
      action: "Created a doctor account",
      code: "staff.created",
      category: "account",
      targetType: "user",
      targetId: user.uid,
      meta: requestMeta(request),
    });
    await batch.commit();
  } catch (err) {
    // Don't leave a half-made account behind.
    await admin.auth().deleteUser(user.uid).catch(() => {});
    throw err;
  }

  return { uid: user.uid, email };
});

/* ------------------------------------------------------------------ */
/* setAccountStatus                                                    */
/* ------------------------------------------------------------------ */

/** data: { uid, status: "active" | "deactivated" } */
exports.setAccountStatus = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const d = request.data || {};
  const targetUid = docId(d.uid, "Account");
  const status = d.status;
  if (status !== "active" && status !== "deactivated") {
    throw new HttpsError("invalid-argument", "Choose a valid status.");
  }
  if (targetUid === caller.uid) {
    throw new HttpsError("failed-precondition", "You can't change your own account.");
  }

  let target;
  try {
    target = await admin.auth().getUser(targetUid);
  } catch {
    throw new HttpsError("not-found", "Account not found.");
  }
  const role = target.customClaims?.role;
  if (role === "admin") {
    throw new HttpsError(
      "permission-denied",
      "Admin accounts can't be changed from the app.",
    );
  }
  if (role !== "doctor" && role !== "patient") {
    throw new HttpsError("failed-precondition", "This account has no role.");
  }

  const ref = db.collection(role === "patient" ? "users" : "adminUsers").doc(targetUid);
  const batch = db.batch();
  batch.update(ref, {
    status,
    updatedAt: serverTime(),
    statusChangedByUid: caller.uid,
  });
  if (role === "doctor") {
    batch.set(
      db.collection("doctorProfiles").doc(targetUid),
      { isListed: status === "active", updatedAt: serverTime() },
      { merge: true },
    );
  }
  audit(batch, {
    actorId: caller.uid,
    actorRole: "admin",
    action: status === "active" ? "Reactivated an account" : "Deactivated an account",
    code: status === "active" ? "account.reactivated" : "account.deactivated",
    category: "account",
    targetType: role,
    targetId: targetUid,
    patientUid: role === "patient" ? targetUid : null,
    meta: requestMeta(request),
  });
  await batch.commit();

  await admin.auth().updateUser(targetUid, { disabled: status !== "active" });
  if (status !== "active") {
    await admin.auth().revokeRefreshTokens(targetUid);
  }
  return { ok: true };
});
