// functions/staffAuth.js
//
//   confirmStaffSession      called by the staff sign-in page after the
//                            password (and authenticator) step, and on page
//                            reload. Says what the account still needs; on
//                            first use, pins the authenticator with the
//                            one-time setup code.
//   resetStaffAuthenticator  admin, for a doctor who lost their phone (or
//                            is setting up for the first time): issues a
//                            new setup code to hand over in person.
//
// Admins and doctors both sign in with an authenticator app (TOTP,
// Identity Platform). Firebase asks for its code during sign-in once one
// is enrolled. Enforcement: lib/core.js requireRole and isAdmin()/isDoctor()
// in both rules files require that this sign-in used the PINNED factor.
//
// Why a setup code: anyone with the password could enroll their own
// authenticator in Firebase. Pinning needs the code (lib/staffSetup.js),
// so their authenticator never gets access. If that happens, the real
// staff member can't sign in (Firebase asks for the stranger's code):
// reset their authenticator and issue a new code.

const crypto = require("crypto");
const {
  onCall,
  admin,
  db,
  FieldValue,
  serverTime,
  HttpsError,
  requestMeta,
  requireRole,
  docId,
  audit,
  rateLimit,
  profileRef,
  assertStaffSecondFactor,
} = require("./lib/core");
const { SETUP_CODE_MAX_ATTEMPTS } = require("./lib/securityConfig");
const { issueSetupCode, setupHash } = require("./lib/staffSetup");

/** Signed-in staff with an active profile; no second-factor check yet. */
async function staffBase(request) {
  const auth = request.auth;
  if (!auth) throw new HttpsError("unauthenticated", "Please sign in to continue.");
  const role = auth.token.role;
  if (role !== "admin" && role !== "doctor") {
    throw new HttpsError("permission-denied", "Your account can't do that.");
  }
  const snap = await profileRef(auth.uid, role).get();
  if (!snap.exists || snap.data().status !== "active") {
    throw new HttpsError("permission-denied", "This account is not active. Please contact the hospital.");
  }
  return { uid: auth.uid, role, profile: snap.data(), token: auth.token, ref: snap.ref };
}

function sameHash(a, b) {
  const x = Buffer.from(String(a || ""), "hex");
  const y = Buffer.from(String(b || ""), "hex");
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/* ------------------------------------------------------------------ */
/* confirmStaffSession                                                 */
/* ------------------------------------------------------------------ */

/**
 * data: { setupCode? }
 * Returns { status }:
 *   "ok"            done: the authenticator used is the pinned one
 *   "totp_enroll"   no authenticator yet: set one up, then sign in with it
 *   "totp_signin"   has one, but this sign-in didn't use it: sign in again
 *   "setup_code"    first sign-in with a new authenticator: enter the
 *                   setup code from IT / an admin
 *   "setup_expired" no valid setup code: ask for a new one
 */
exports.confirmStaffSession = onCall(async (request) => {
  const caller = await staffBase(request);
  const meta = requestMeta(request);
  await rateLimit(caller.uid, "confirmStaffSession", { max: 30, windowSeconds: 3600 });

  const fb = caller.token.firebase || {};
  if (fb.sign_in_second_factor !== "totp") {
    const user = await admin.auth().getUser(caller.uid);
    const totp = (user.multiFactor?.enrolledFactors || []).filter((f) => f.factorId === "totp");
    return { status: totp.length ? "totp_signin" : "totp_enroll" };
  }

  if (!caller.profile.mfaFactorUid) {
    const setup = caller.profile.mfaSetup;
    const expired = !setup?.hash || (setup.expiresAt?.toMillis?.() ?? 0) < Date.now();
    if (expired) return { status: "setup_expired" };
    const given = typeof request.data?.setupCode === "string" ? request.data.setupCode : "";
    if (!given) return { status: "setup_code" };

    const outcome = await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(caller.ref)).data();
      if (fresh.mfaFactorUid) return "pinned_already";
      const s = fresh.mfaSetup;
      if (!s?.hash || (s.expiresAt?.toMillis?.() ?? 0) < Date.now()) return "expired";
      if (!sameHash(setupHash(caller.uid, given), s.hash)) {
        const attempts = (s.attempts || 0) + 1;
        if (attempts >= SETUP_CODE_MAX_ATTEMPTS) {
          tx.update(caller.ref, { mfaSetup: FieldValue.delete() });
          return "locked";
        }
        tx.update(caller.ref, { "mfaSetup.attempts": attempts });
        return "wrong";
      }
      tx.update(caller.ref, {
        mfaFactorUid: fb.second_factor_identifier,
        mfaPinnedAt: serverTime(),
        mfaSetup: FieldValue.delete(),
      });
      audit(tx, {
        actorId: caller.uid,
        actorRole: caller.role,
        action: "Registered an authenticator app for staff sign-in",
        code: "staff.mfa_pinned",
        category: "security",
        targetType: "user",
        targetId: caller.uid,
        meta,
      });
      return "ok";
    });

    if (outcome === "wrong" || outcome === "locked") {
      await audit(null, {
        actorId: caller.uid,
        actorRole: caller.role,
        action: outcome === "locked"
          ? "Staff setup code cancelled after too many wrong tries"
          : "Wrong staff setup code entered",
        code: "staff.mfa_failed",
        category: "security",
        result: "denied",
        targetType: "user",
        targetId: caller.uid,
        meta,
      });
      throw new HttpsError(
        outcome === "wrong" ? "invalid-argument" : "failed-precondition",
        outcome === "wrong"
          ? "That setup code isn't right. Check it and try again."
          : "Too many wrong setup codes. Ask for a new one.",
      );
    }
    if (outcome === "expired") return { status: "setup_expired" };
    caller.profile = (await caller.ref.get()).data();
  }

  try {
    assertStaffSecondFactor(caller.token, caller.profile);
  } catch (err) {
    await audit(null, {
      actorId: caller.uid,
      actorRole: caller.role,
      action: "Staff sign-in refused: unrecognised authenticator or expired session",
      code: "staff.mfa_refused",
      category: "security",
      result: "denied",
      targetType: "user",
      targetId: caller.uid,
      meta,
    });
    throw err;
  }
  return { status: "ok" };
});

/* ------------------------------------------------------------------ */
/* resetStaffAuthenticator                                             */
/* ------------------------------------------------------------------ */

/**
 * data: { uid, reset?: boolean } -> { setupCode }
 * Admin only, for doctors (admins are reset by IT with the staffAdmin
 * script). reset removes the doctor's current authenticator and signs
 * them out; without it, a code is just (re)issued for a first setup.
 */
exports.resetStaffAuthenticator = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const uid = docId(request.data?.uid, "Account");
  const reset = request.data?.reset === true;
  await rateLimit(caller.uid, "resetStaffAuthenticator", { max: 20, windowSeconds: 3600 });

  const snap = await db.collection("adminUsers").doc(uid).get();
  if (!snap.exists || snap.data().role !== "doctor") {
    throw new HttpsError("permission-denied", "Only doctors' authenticators can be reset here.");
  }
  if (!reset && snap.data().mfaFactorUid) {
    throw new HttpsError(
      "failed-precondition",
      "This doctor already has an authenticator. Use reset if they lost their phone.",
    );
  }
  const setupCode = await issueSetupCode(uid, { reset });
  await audit(null, {
    actorId: caller.uid,
    actorRole: "admin",
    action: reset
      ? "Reset a doctor's authenticator and issued a setup code"
      : "Issued a doctor's authenticator setup code",
    code: reset ? "staff.mfa_reset" : "staff.setup_code_issued",
    category: "security",
    targetType: "user",
    targetId: uid,
    meta: requestMeta(request),
  });
  return { setupCode };
});
