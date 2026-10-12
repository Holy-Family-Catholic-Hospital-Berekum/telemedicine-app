// functions/scripts/resetTestPayments.js
//
// Run ONCE, locally, by the project owner, just before go-live (before the
// live Paystack keys are switched on). Never deployed.
//
// Everything paid so far was Paystack TEST money. Left in place, test
// bookings, revenue and refunds would mix with real ones, and the server
// would ask the LIVE Paystack about test payments. This clears the payment
// and booking data so the live system starts clean.
//
// Credentials: `gcloud auth application-default login` with an account that
// has Firebase Admin on the project, then from functions/:
//
//   node scripts/resetTestPayments.js --project live
//       Dry run: prints what would be deleted. Changes nothing.
//   node scripts/resetTestPayments.js --project live --confirm telemedicine-hfch
//       Deletes it (the project ID must be typed to confirm).
// Without --project live it acts on the TEST project.
//
// Deleted (test data only): bookings, consultations, consultationHistory,
// confirmedPayments, bookingLog, paymentRefs, paymentIssues, refundRequests,
// calls (with their signalling sub-collections), the mail outbox, and time
// slots that were held or booked (open slots are kept).
// Also records the launch date (systemSettings/features.launchedAt): from
// then on, saving the terms or privacy policy creates a new version.
// NOT touched: accounts (users, adminUsers), doctorProfiles, consents and
// the audit log (legal records), recordings (deleting those still needs two
// admins in the app), site settings, legal text.

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// Test project unless `--project live` (scripts/project.js).
const { chooseProject } = require("./project");
const { projectId: PROJECT_ID, argv: ARGV } = chooseProject(process.argv.slice(2));
initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

const CLEAR = [
  "bookings",
  "consultations",
  "consultationHistory",
  "confirmedPayments",
  "bookingLog",
  "paymentRefs",
  "paymentIssues",
  "refundRequests",
  "calls",
  "mail",
];

async function main() {
  const args = ARGV;
  const confirmed = args[0] === "--confirm" && args[1] === PROJECT_ID;
  if (args.length && !confirmed) {
    console.error(`To delete, run: node scripts/resetTestPayments.js --confirm ${PROJECT_ID}`);
    process.exit(1);
  }

  const counts = {};
  for (const name of CLEAR) {
    counts[name] = (await db.collection(name).count().get()).data().count;
  }
  const slots = await db.collection("availableSlots").where("status", "in", ["held", "booked"]).get();
  counts["availableSlots (held/booked)"] = slots.size;

  console.log(confirmed ? "Deleting:" : "Dry run. Would delete:");
  for (const [name, n] of Object.entries(counts)) console.log(`  ${name}: ${n}`);
  if (!confirmed) {
    console.log(`\nNothing changed. To delete: node scripts/resetTestPayments.js --confirm ${PROJECT_ID}`);
    return;
  }

  for (const name of CLEAR) {
    await db.recursiveDelete(db.collection(name));
    console.log(`  cleared ${name}`);
  }
  for (const doc of slots.docs) await doc.ref.delete();
  console.log(`  deleted ${slots.size} held/booked slots`);

  await db.collection("auditLog").add({
    actorId: "owner-script",
    actorRole: "system",
    action: "Cleared Paystack test-mode payment and booking data before go-live",
    code: "maintenance.test_data_cleared",
    category: "payment",
    result: "success",
    details: counts,
    timestamp: FieldValue.serverTimestamp(),
  });

  // Go-live: from now on each save of the terms or privacy policy is a new
  // version (before this, saves stay version 1; functions/legalDocs.js).
  // Kept if it's already set (running the script again doesn't move it).
  const featuresRef = db.collection("systemSettings").doc("features");
  const features = await featuresRef.get();
  if (!features.exists || !features.data().launchedAt) {
    await featuresRef.set({ launchedAt: FieldValue.serverTimestamp() }, { merge: true });
    console.log("  recorded the launch date (legal versions now count from 2)");
  }
  console.log("\nDone. Next: switch to the live Paystack keys (SECURITY_SETUP.md, go-live).");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
