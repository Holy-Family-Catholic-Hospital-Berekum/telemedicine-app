// functions/scripts/clearDemoData.js
//
// Run ONCE, locally, by the project owner, just before go-live, AFTER
// resetTestPayments.js (it refuses while any booking is left). Never deployed.
//
// Removes the demo accounts and what they left behind, so the live system
// starts with only its admin account(s). resetTestPayments.js clears the
// payment and booking side; this clears the rest.
//
// Credentials: `gcloud auth application-default login` with an account that
// has Firebase Admin on the project, then from functions/:
//
//   node scripts/clearDemoData.js --project live
//       Dry run: lists the accounts and counts what would be deleted.
//   node scripts/clearDemoData.js --project live --confirm telemedicine-hfch
//       Deletes it (the project ID must be typed to confirm).
// Without --project live it acts on the TEST project.
//
// Deleted:
//   - every account whose role claim isn't "admin" (patients, doctors, and
//     accounts with no role), with its users/adminUsers profile, doctor
//     profile, signature, and profile photo;
//   - every call recording (records and files). In the app deleting a
//     recording needs two admins; this is the owner's one-off clear-out of
//     test calls before launch, recorded in the audit log;
//   - consents (all given by demo accounts), prescriptions, support
//     conversations, registered room computers, time slots, call rooms,
//     report/access/deletion requests, rate-limit counters, the mail outbox
//     and the unused staffSessions collection.
// NOT touched: admin accounts, the audit log (also copied to the locked log
// bucket), site settings and images, legal text, system settings.

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { getStorage } = require("firebase-admin/storage");

// Test project unless `--project live` (scripts/project.js).
const { chooseProject } = require("./project");
const { projectId: PROJECT_ID, argv: ARGV } = chooseProject(process.argv.slice(2));
initializeApp({ projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.firebasestorage.app` });
const db = getFirestore();
const bucket = getStorage().bucket();

// Cleared whole (with sub-collections).
const CLEAR = [
  "recordings",
  "consents",
  "prescriptions",
  "prescriptionSignatures",
  "supportThreads",
  "supportStaff",
  "roomDevices",
  "availableSlots",
  "calls",
  "reportRequests",
  "reportData",
  "accessRequests",
  "deletionRequests",
  "rateLimits",
  "mail",
  "staffSessions",
];
// Keyed by account uid: every doc not belonging to a kept admin goes.
const PER_ACCOUNT = ["users", "adminUsers", "doctorProfiles", "doctorSignatures"];
// Storage folders: recordings/{id}/… all go; photos of non-admins go.
const RECORDINGS_PREFIX = "recordings/";
const PHOTOS_PREFIX = "doctorProfilePictures/";

async function listAccounts() {
  const users = [];
  let pageToken;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

const isAdmin = (u) => (u.customClaims || {}).role === "admin";

async function main() {
  const args = ARGV;
  const confirmed = args[0] === "--confirm" && args[1] === PROJECT_ID;
  if (args.length && !confirmed) {
    console.error(`To delete, run: node scripts/clearDemoData.js --confirm ${PROJECT_ID}`);
    process.exit(1);
  }

  // A deleted patient with a booking would be refunded by the daily sweep
  // (lib/accountDeletion.js): clear payments first, deliberately.
  const bookings = (await db.collection("bookings").count().get()).data().count;
  if (bookings) {
    console.error(`${bookings} booking(s) left. Run scripts/resetTestPayments.js first.`);
    process.exit(1);
  }

  const accounts = await listAccounts();
  const admins = accounts.filter(isAdmin);
  const remove = accounts.filter((u) => !isAdmin(u));
  if (!admins.length) {
    console.error("No admin account found; refusing (nobody could sign in afterwards).");
    process.exit(1);
  }
  const keep = new Set(admins.map((u) => u.uid));

  console.log("Keeping admin account(s):");
  for (const u of admins) console.log(`  ${u.email} (${u.uid})`);
  console.log(confirmed ? "\nDeleting accounts:" : "\nDry run. Would delete accounts:");
  for (const u of remove) {
    console.log(`  ${(u.customClaims || {}).role || "no role"}: ${u.email || "(no email)"} (${u.uid})`);
  }

  const counts = { accounts: remove.length };
  const perAccount = {};
  for (const name of PER_ACCOUNT) {
    const snap = await db.collection(name).get();
    perAccount[name] = snap.docs.filter((d) => !keep.has(d.id));
    counts[name] = perAccount[name].length;
  }
  for (const name of CLEAR) {
    counts[name] = (await db.collection(name).count().get()).data().count;
  }
  const [recordingFiles] = await bucket.getFiles({ prefix: RECORDINGS_PREFIX });
  const [photoFiles] = await bucket.getFiles({ prefix: PHOTOS_PREFIX });
  const photos = photoFiles.filter((f) => !keep.has(f.name.split("/")[1]));
  counts["recording files"] = recordingFiles.length;
  counts["profile photos"] = photos.length;

  console.log(confirmed ? "\nDeleting records:" : "\nWould delete records:");
  for (const [name, n] of Object.entries(counts)) console.log(`  ${name}: ${n}`);
  if (!confirmed) {
    console.log(`\nNothing changed. To delete: node scripts/clearDemoData.js --confirm ${PROJECT_ID}`);
    return;
  }

  // Accounts first, so nobody signs in to a half-deleted account.
  if (remove.length) {
    const result = await getAuth().deleteUsers(remove.map((u) => u.uid));
    if (result.failureCount) {
      for (const e of result.errors) console.error(`  account ${remove[e.index].uid}: ${e.error.message}`);
      throw new Error("Some accounts could not be deleted; nothing else was changed. Run again.");
    }
    console.log(`  deleted ${remove.length} accounts`);
  }
  for (const name of PER_ACCOUNT) {
    for (const doc of perAccount[name]) await db.recursiveDelete(doc.ref);
    console.log(`  cleared ${name} (except admins)`);
  }
  for (const name of CLEAR) {
    await db.recursiveDelete(db.collection(name));
    console.log(`  cleared ${name}`);
  }
  await bucket.deleteFiles({ prefix: RECORDINGS_PREFIX });
  for (const f of photos) await f.delete();
  console.log("  deleted recording files and profile photos");

  await db.collection("auditLog").add({
    actorId: "owner-script",
    actorRole: "system",
    action: "Cleared demo accounts, test recordings and test records before go-live",
    code: "maintenance.demo_data_cleared",
    category: "system",
    result: "success",
    details: counts,
    timestamp: FieldValue.serverTimestamp(),
  });
  console.log("\nDone. Only the admin account(s) remain; doctors are created again in the Users tab.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
