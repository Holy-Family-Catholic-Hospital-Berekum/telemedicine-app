// functions/staffAuth.js
//
//   confirmStaffSession  called by the staff sign-in page right after the
//                        password step (and on page reload). Says what the
//                        account still needs, and for doctors emails a code.
//   verifyStaffCode      doctor enters the emailed 6-digit code
//
// Second factor for staff (enforced in lib/core.js requireRole and in the
// Security Rules):
//
// Admin: authenticator app (TOTP, Firebase Identity Platform). Firebase asks
//   for the code during sign-in once a factor is enrolled. The first factor
//   an admin signs in with is pinned to adminUsers.mfaFactorUid, so a
//   second authenticator added later (e.g. by someone who got hold of a
//   session) isn't accepted. Resetting it is an IT task
//   (scripts/staffAdmin.js reset-mfa).
//
// Doctor: a 6-digit code emailed for each sign-in, bound to that sign-in's
//   auth_time, valid STAFF_CODE_MINUTES with STAFF_CODE_MAX_ATTEMPTS tries.
//   Only a hash is stored. Until a verified sending domain is set
//   (lib/mailConfig.js) no email can go out, so the session is confirmed
//   without a code and that is written to the audit log every time.
//
// staffSessions/{uid} has no client access (rules default deny).

const crypto = require("crypto");
const {
  onCall,
  admin,
  db,
  Timestamp,
  serverTime,
  HttpsError,
  requestMeta,
  str,
  sha256,
  audit,
  rateLimit,
  profileRef,
  assertAdminSecondFactor,
  doctorSessionVerified,
} = require("./lib/core");
const {
  DOCTOR_SESSION_MAX_HOURS,
  STAFF_CODE_MINUTES,
  STAFF_CODE_MAX_ATTEMPTS,
} = require("./lib/securityConfig");
const { EMAIL_CONFIGURED } = require("./lib/mailConfig");
const { queueEmail } = require("./lib/mailQueue");

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

const codeHash = (uid, authTime, code) => sha256(`${uid}:${authTime}:${code}`);

function maskEmail(email) {
  const [user, domain] = String(email || "").split("@");
  if (!domain) return "your email";
  return `${user.slice(0, 2)}${"•".repeat(Math.max(1, user.length - 2))}@${domain}`;
}

/* ------------------------------------------------------------------ */
/* confirmStaffSession                                                 */
/* ------------------------------------------------------------------ */

/**
 * data: { sendCode?: boolean } (default true; false on page reload)
 * Returns { status }:
 *   "ok"           second factor done for this sign-in
 *   "totp_enroll"  admin has no authenticator yet: set one up
 *   "totp_signin"  admin must sign in again using the authenticator
 *   "email_code"   doctor: a code was emailed ({ sentTo })
 *   "code_needed"  doctor: no code sent (sendCode false); sign in again
 */
exports.confirmStaffSession = onCall(async (request) => {
  const caller = await staffBase(request);
  const meta = requestMeta(request);
  await rateLimit(caller.uid, "confirmStaffSession", { max: 30, windowSeconds: 3600 });

  if (caller.role === "admin") {
    const fb = caller.token.firebase || {};
    if (fb.sign_in_second_factor !== "totp") {
      const user = await admin.auth().getUser(caller.uid);
      const totp = (user.multiFactor?.enrolledFactors || []).filter((f) => f.factorId === "totp");
      return { status: totp.length ? "totp_signin" : "totp_enroll" };
    }
    // First authenticator sign-in pins that factor to the account.
    if (!caller.profile.mfaFactorUid) {
      const pinned = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(caller.ref);
        if (fresh.data().mfaFactorUid) return fresh.data().mfaFactorUid;
        tx.update(caller.ref, {
          mfaFactorUid: fb.second_factor_identifier,
          mfaPinnedAt: serverTime(),
        });
        audit(tx, {
          actorId: caller.uid,
          actorRole: "admin",
          action: "Registered an authenticator app for admin sign-in",
          code: "staff.mfa_pinned",
          category: "security",
          targetType: "user",
          targetId: caller.uid,
          meta,
        });
        return fb.second_factor_identifier;
      });
      caller.profile.mfaFactorUid = pinned;
    }
    try {
      assertAdminSecondFactor(caller.token, caller.profile);
    } catch (err) {
      await audit(null, {
        actorId: caller.uid,
        actorRole: "admin",
        action: "Admin sign-in refused: unrecognised authenticator or expired session",
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
  }

  // Doctor
  if (await doctorSessionVerified(caller.uid, caller.token)) return { status: "ok" };
  if (request.data?.sendCode === false) return { status: "code_needed" };

  const authTime = Number(caller.token.auth_time);
  const sessionRef = db.collection("staffSessions").doc(caller.uid);
  const email = caller.profile.email || caller.token.email;

  if (!EMAIL_CONFIGURED || !email) {
    // No way to send a code yet: confirm, but leave a trail every time.
    await sessionRef.set({
      verified: true,
      authTime,
      method: "none_email_not_configured",
      verifiedAt: serverTime(),
      expiresAt: Timestamp.fromMillis(Date.now() + DOCTOR_SESSION_MAX_HOURS * 3600 * 1000),
    });
    await audit(null, {
      actorId: caller.uid,
      actorRole: "doctor",
      action: "Doctor signed in without an email code (email sending isn't set up yet)",
      code: "staff.mfa_unavailable",
      category: "security",
      result: "failed",
      targetType: "user",
      targetId: caller.uid,
      meta,
    });
    return { status: "ok" };
  }

  await rateLimit(caller.uid, "staffCodeSend", { max: 5, windowSeconds: 900 });
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAtMs = Date.now() + STAFF_CODE_MINUTES * 60 * 1000;
  const batch = db.batch();
  batch.set(sessionRef, {
    verified: false,
    authTime,
    codeHash: codeHash(caller.uid, authTime, code),
    codeExpiresAt: Timestamp.fromMillis(expiresAtMs),
    attempts: 0,
    createdAt: serverTime(),
  });
  queueEmail(batch, {
    to: email,
    kind: "staff_login_code",
    data: {
      code,
      doctorName: caller.profile.name || "",
      minutes: STAFF_CODE_MINUTES,
      scheduledAt: expiresAtMs, // templates expect a time; unused here
    },
    sendBefore: expiresAtMs,
    // The code is useless after it expires; don't keep it around.
    deleteAfterMs: 60 * 60 * 1000,
  });
  await batch.commit();
  return { status: "email_code", sentTo: maskEmail(email) };
});

/* ------------------------------------------------------------------ */
/* verifyStaffCode                                                     */
/* ------------------------------------------------------------------ */

/** data: { code } -> { status: "ok" } */
exports.verifyStaffCode = onCall(async (request) => {
  const caller = await staffBase(request);
  if (caller.role !== "doctor") {
    throw new HttpsError("permission-denied", "Your account can't do that.");
  }
  const code = str(request.data?.code, { field: "Code", max: 6, min: 6 });
  if (!/^\d{6}$/.test(code)) throw new HttpsError("invalid-argument", "Enter the 6-digit code.");
  await rateLimit(caller.uid, "verifyStaffCode", { max: 20, windowSeconds: 900 });

  const authTime = Number(caller.token.auth_time);
  const sessionRef = db.collection("staffSessions").doc(caller.uid);
  const meta = requestMeta(request);

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(sessionRef);
    const s = snap.exists ? snap.data() : null;
    if (!s || s.verified || s.authTime !== authTime || !s.codeHash) return "no_code";
    if ((s.codeExpiresAt?.toMillis?.() ?? 0) < Date.now()) return "expired";
    if ((s.attempts || 0) >= STAFF_CODE_MAX_ATTEMPTS) return "locked";

    const given = Buffer.from(codeHash(caller.uid, authTime, code), "hex");
    const stored = Buffer.from(s.codeHash, "hex");
    const match = given.length === stored.length && crypto.timingSafeEqual(given, stored);
    if (!match) {
      tx.update(sessionRef, { attempts: (s.attempts || 0) + 1 });
      return (s.attempts || 0) + 1 >= STAFF_CODE_MAX_ATTEMPTS ? "locked" : "wrong";
    }
    tx.set(sessionRef, {
      verified: true,
      authTime,
      method: "email_code",
      verifiedAt: serverTime(),
      expiresAt: Timestamp.fromMillis(Date.now() + DOCTOR_SESSION_MAX_HOURS * 3600 * 1000),
    });
    audit(tx, {
      actorId: caller.uid,
      actorRole: "doctor",
      action: "Doctor confirmed sign-in with an emailed code",
      code: "staff.mfa_verified",
      category: "security",
      targetType: "user",
      targetId: caller.uid,
      meta,
    });
    return "ok";
  });

  if (outcome === "ok") return { status: "ok" };
  if (outcome === "wrong" || outcome === "locked") {
    await audit(null, {
      actorId: caller.uid,
      actorRole: "doctor",
      action: outcome === "locked"
        ? "Doctor sign-in code locked after too many wrong tries"
        : "Wrong doctor sign-in code entered",
      code: "staff.mfa_failed",
      category: "security",
      result: "denied",
      targetType: "user",
      targetId: caller.uid,
      meta,
    });
  }
  const messages = {
    wrong: "That code isn't right. Check the email and try again.",
    locked: "Too many wrong codes. Please sign in again to get a new code.",
    expired: "That code has expired. Please sign in again to get a new code.",
    no_code: "Please sign in again to get a new code.",
  };
  throw new HttpsError(outcome === "wrong" ? "invalid-argument" : "failed-precondition", messages[outcome]);
});
