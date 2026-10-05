// functions/lib/staffSetup.js
//
// One-time setup codes for staff authenticators.
//
// Anyone who learns a staff member's password can register an
// authenticator app with Firebase in their name. That authenticator only
// counts once it's pinned to the account (adminUsers.mfaFactorUid), and
// pinning needs the setup code below, which is handed over in person by IT
// (admins: scripts/staffAdmin.js) or an admin (doctors: the Users tab).
// Only a hash is stored; codes expire after SETUP_CODE_HOURS.

const { admin, db, Timestamp, FieldValue, sha256, randomCode } = require("./core");
const { SETUP_CODE_HOURS } = require("./securityConfig");

const setupHash = (uid, code) =>
  sha256(`${uid}:${String(code).toUpperCase().replace(/[^A-Z0-9]/g, "")}`);

/**
 * Issues a new setup code for `uid` and returns it ("ABCDE-FGHJK").
 * With reset: true, also removes their enrolled authenticators and the
 * pinned one, and signs them out everywhere (lost or replaced phone).
 */
async function issueSetupCode(uid, { reset = false } = {}) {
  // Whoever issues the code vouches for the staff email; Firebase only
  // lets a verified email register an authenticator.
  const user = await admin.auth().getUser(uid);
  if (!user.emailVerified) await admin.auth().updateUser(uid, { emailVerified: true });
  if (reset) {
    await admin.auth().updateUser(uid, { multiFactor: { enrolledFactors: null } });
  }
  const raw = randomCode(10);
  await db.collection("adminUsers").doc(uid).set(
    {
      mfaSetup: {
        hash: setupHash(uid, raw),
        expiresAt: Timestamp.fromMillis(Date.now() + SETUP_CODE_HOURS * 3600 * 1000),
        attempts: 0,
      },
      ...(reset ? { mfaFactorUid: FieldValue.delete(), mfaPinnedAt: FieldValue.delete() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  if (reset) await admin.auth().revokeRefreshTokens(uid);
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

module.exports = { issueSetupCode, setupHash };
