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
  console.log(`${email} is now an admin. They must sign in again.`);
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
const run =
  command === "make-admin"
    ? makeAdmin(args[0], args.slice(1).join(" "))
    : command === "sync-claims"
      ? syncClaims()
      : Promise.reject(new Error("Commands: make-admin <email> <name> | sync-claims"));

run.then(
  () => process.exit(0),
  (err) => {
    console.error(err.message);
    process.exit(1);
  },
);
