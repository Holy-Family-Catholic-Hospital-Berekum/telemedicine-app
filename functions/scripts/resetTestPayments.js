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
//   node scripts/resetTestPayments.js
//       Dry run: prints what would be deleted. Changes nothing.
//   node scripts/resetTestPayments.js --confirm telemedicine-hfch
//       Deletes it (the project ID must be typed to confirm).
//
// Deleted (test data only): bookings, consultations, consultationHistory,
// confirmedPayments, bookingLog, paymentRefs, paymentIssues, refundRequests,
// calls (with their signalling sub-collections), the mail outbox, and time
// slots that were held or booked (open slots are kept).
// NOT touched: accounts (users, adminUsers), doctorProfiles, consents and
// the audit log (legal records), recordings (deleting those still needs two
// admins in the app), site settings, legal text.

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "telemedicine-hfch";
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
  const args = process.argv.slice(2);
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
  console.log("\nDone. Next: switch to the live Paystack keys (SECURITY_SETUP.md, go-live).");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
