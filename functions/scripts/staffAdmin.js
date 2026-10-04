// functions/scripts/staffAdmin.js
//
// Run locally by the hospital's IT owner, never deployed. Admin accounts
// are deliberately not creatable from the app.
//
// Credentials: `gcloud auth application-default login` with an account
// that has Firebase Admin on the project, then from functions/:
//
//   node scripts/staffAdmin.js make-admin someone@hospital.org "Full Name"
//       Promotes an existing Auth user (sign up first, or create the user
//       in the Firebase console) to admin: sets the role claim and writes
//       adminUsers/{uid}.
//
//   node scripts/staffAdmin.js sync-claims
//       Gives every existing adminUsers / users document's account the
//       matching role claim. Use once after upgrading, so accounts created
//       before claims existed can still sign in.
//
//   node scripts/staffAdmin.js reset-mfa someone@hospital.org
//       Admin lost their authenticator: removes their enrolled factors and
//       the pinned one, signs them out everywhere. They set up a new
//       authenticator at their next sign-in. Verify who is asking first
//       (in person or by a call to a known number), never by email alone.
//
// One-off project hardening (needs the Identity Platform upgrade; see
// SECURITY_SETUP.md). Each prints what it changed:
//
//   node scripts/staffAdmin.js enable-totp
//       Turns on authenticator-app (TOTP) multi-factor sign-in.
//   node scripts/staffAdmin.js password-policy
//       Enforces the sign-up page's password rules on Firebase's side too
//       (10+ characters, upper and lower case, a number and a symbol).
//   node scripts/staffAdmin.js auth-recaptcha
//       Turns on reCAPTCHA Enterprise protection for email/password sign-in
//       and sign-up (blocks scripted password guessing).

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "telemedicine-hfch";
initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const admin = { auth: () => getAuth() };

async function makeAdmin(email, name) {
  if (!email || !name) {
    throw new Error("Usage: make-admin <email> \"<full name>\"");
  }
  const user = await admin.auth().getUserByEmail(email.trim().toLowerCase());
  const patientDoc = await db.collection("users").doc(user.uid).get();
  if (patientDoc.exists) {
    throw new Error("That account is a patient account. Use a separate staff email.");
  }
  await admin.auth().setCustomUserClaims(user.uid, { role: "admin" });
  // Authenticator enrollment requires a verified email. The IT owner
  // vouches for the staff address by running this command.
  if (!user.emailVerified) {
    await admin.auth().updateUser(user.uid, { emailVerified: true });
  }
  await db.collection("adminUsers").doc(user.uid).set(
    {
      uid: user.uid,
      role: "admin",
      name,
      email: user.email,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await db.collection("auditLog").add({
    actorId: "script",
    actorRole: "system",
    action: "Promoted an account to admin (staffAdmin script)",
    code: "staff.admin_created",
    category: "account",
    targetType: "user",
    targetId: user.uid,
    result: "success",
    timestamp: FieldValue.serverTimestamp(),
  });
  await admin.auth().revokeRefreshTokens(user.uid);
  console.log(
    `${email} is now an admin. They must sign in again on the staff page, where ` +
      "they'll be asked to set up an authenticator app straight away. Do it now: " +
      "until they have, anyone with their password could set one up instead.",
  );
}

async function resetMfa(email) {
  if (!email) throw new Error("Usage: reset-mfa <email>");
  const user = await admin.auth().getUserByEmail(email.trim().toLowerCase());
  await admin.auth().updateUser(user.uid, { multiFactor: { enrolledFactors: null } });
  await db.collection("adminUsers").doc(user.uid).set(
    { mfaFactorUid: FieldValue.delete(), mfaPinnedAt: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  await admin.auth().revokeRefreshTokens(user.uid);
  await db.collection("auditLog").add({
    actorId: "script",
    actorRole: "system",
    action: "Reset a staff member's authenticator (staffAdmin script)",
    code: "staff.mfa_reset",
    category: "security",
    targetType: "user",
    targetId: user.uid,
    result: "success",
    timestamp: FieldValue.serverTimestamp(),
  });
  console.log(`${email}: authenticator removed and signed out everywhere. They set up a new one at next sign-in.`);
}

async function enableTotp() {
  await admin.auth().projectConfigManager().updateProjectConfig({
    multiFactorConfig: {
      providerConfigs: [{ state: "ENABLED", totpProviderConfig: { adjacentIntervals: 1 } }],
    },
  });
  console.log("Authenticator-app (TOTP) multi-factor sign-in is enabled.");
}

async function passwordPolicy() {
  await admin.auth().projectConfigManager().updateProjectConfig({
    passwordPolicyConfig: {
      enforcementState: "ENFORCE",
      forceUpgradeOnSignin: false,
      constraints: {
        minLength: 10,
        maxLength: 128,
        requireUppercase: true,
        requireLowercase: true,
        requireNumeric: true,
        requireNonAlphanumeric: true,
      },
    },
  });
  console.log("Password policy enforced: 10+ characters, upper, lower, number and symbol.");
}

async function authRecaptcha() {
  await admin.auth().projectConfigManager().updateProjectConfig({
    recaptchaConfig: {
      emailPasswordEnforcementState: "ENFORCE",
      // Block the most bot-like traffic; Google's score runs 0 (bot) to 1 (human).
      managedRules: [{ endScore: 0.3, action: "BLOCK" }],
      useAccountDefender: false,
    },
  });
  console.log("reCAPTCHA Enterprise protection is enforced for email/password sign-in and sign-up.");
}

async function syncClaims() {
  let count = 0;
  for (const [collection, fallbackRole] of [["adminUsers", null], ["users", "patient"]]) {
    const snap = await db.collection(collection).get();
    for (const doc of snap.docs) {
      const role = fallbackRole || doc.data().role;
      if (!["admin", "doctor", "patient"].includes(role)) {
        console.warn(`Skipping ${collection}/${doc.id}: unknown role "${role}"`);
        continue;
      }
      try {
        const user = await admin.auth().getUser(doc.id);
        if (user.customClaims?.role !== role) {
          await admin.auth().setCustomUserClaims(doc.id, { role });
          count++;
          console.log(`${collection}/${doc.id} -> ${role}`);
        }
      } catch (err) {
        console.warn(`Skipping ${collection}/${doc.id}: ${err.message}`);
      }
    }
  }
  console.log(`Updated ${count} account(s). Affected users must sign in again.`);
}

const [command, ...args] = process.argv.slice(2);
const COMMANDS = {
  "make-admin": () => makeAdmin(args[0], args.slice(1).join(" ")),
  "sync-claims": () => syncClaims(),
  "reset-mfa": () => resetMfa(args[0]),
  "enable-totp": () => enableTotp(),
  "password-policy": () => passwordPolicy(),
  "auth-recaptcha": () => authRecaptcha(),
};
const run = Object.hasOwn(COMMANDS, command)
  ? COMMANDS[command]()
  : Promise.reject(new Error(`Commands: ${Object.keys(COMMANDS).join(" | ")}`));

run.then(
  () => process.exit(0),
  (err) => {
    console.error(err.message);
    process.exit(1);
  },
);
