// functions/scripts/scrubStaffUids.js
//
// Run ONCE, locally, by the project owner (never deployed), on each project
// after the functions that stopped writing these fields are deployed.
//
// Until 29 Oct 2026 some records patients (or the public) can read carried
// a staff member's uid, and a booking could carry the admin's note on
// "the doctor can't make it". New ones no longer do; this removes them from
// records written before. Who did what stays in the audit log.
//
// Credentials: `gcloud auth application-default login` with an account that
// has Firebase Admin on the project, then from functions/:
//
//   node scripts/scrubStaffUids.js --project live
//       Dry run: prints how many records would change. Changes nothing.
//   node scripts/scrubStaffUids.js --project live --confirm telemedicine-hfch
//       Removes the fields (the project ID must be typed to confirm).
// Without --project live it acts on the TEST project.
//
// Removed (only these fields; nothing else is changed or deleted):
//   refundRequests.resolvedByUid            the patient reads their request
//   consultationHistory.closedByUid         the patient reads their history
//   users.statusChangedByUid                the patient reads their profile
//   bookings.doctorUnavailable.reason/byUid the patient reads their booking
//   siteSettings/public.updatedBy           anyone can read it
//   legalDocs/{terms,privacy}.updatedBy     anyone can read them
//   systemSettings/features.updatedByUid    any signed-in user can read it

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, FieldPath } = require("firebase-admin/firestore");

// Test project unless `--project live` (scripts/project.js).
const { chooseProject } = require("./project");
const { projectId: PROJECT_ID, argv: ARGV } = chooseProject(process.argv.slice(2));
initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

// [collection, field path to find them by, field paths to remove]
const COLLECTIONS = [
  ["refundRequests", "resolvedByUid", ["resolvedByUid"]],
  ["consultationHistory", "closedByUid", ["closedByUid"]],
  ["users", "statusChangedByUid", ["statusChangedByUid"]],
  ["bookings", "doctorUnavailable.byUid", ["doctorUnavailable.reason", "doctorUnavailable.byUid"]],
];
// [document, fields to remove]
const DOCUMENTS = [
  ["siteSettings/public", ["updatedBy"]],
  ["legalDocs/terms", ["updatedBy"]],
  ["legalDocs/privacy", ["updatedBy"]],
  ["systemSettings/features", ["updatedByUid"]],
];

const removal = (fields) => Object.fromEntries(fields.map((f) => [f, FieldValue.delete()]));
const hasAny = (data, fields) =>
  fields.some((f) => f.split(".").reduce((v, k) => (v == null ? undefined : v[k]), data) !== undefined);

/** Every document in `name` where `field` is set (a page at a time). */
async function* withField(name, field) {
  let last = null;
  for (;;) {
    let q = db.collection(name).where(new FieldPath(...field.split(".")), "!=", null)
      .orderBy(new FieldPath(...field.split(".")))
      .limit(400);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    for (const doc of page.docs) yield doc;
    if (page.size < 400) return;
    last = page.docs[page.docs.length - 1];
  }
}

async function main() {
  const confirmed = ARGV[0] === "--confirm" && ARGV[1] === PROJECT_ID;
  if (ARGV.length && !confirmed) {
    console.error(`To change the records, run: node scripts/scrubStaffUids.js --confirm ${PROJECT_ID}`);
    process.exit(1);
  }
  console.log(confirmed ? "Removing:" : "Dry run. Would remove from:");

  const counts = {};
  for (const [name, findBy, fields] of COLLECTIONS) {
    let n = 0;
    let batch = db.batch();
    let inBatch = 0;
    for await (const doc of withField(name, findBy)) {
      n += 1;
      if (!confirmed) continue;
      batch.update(doc.ref, removal(fields));
      if (++inBatch === 400) {
        await batch.commit();
        batch = db.batch();
        inBatch = 0;
      }
    }
    if (confirmed && inBatch) await batch.commit();
    counts[name] = n;
    console.log(`  ${name} (${fields.join(", ")}): ${n}`);
  }
  for (const [path, fields] of DOCUMENTS) {
    const snap = await db.doc(path).get();
    const n = snap.exists && hasAny(snap.data(), fields) ? 1 : 0;
    if (confirmed && n) await snap.ref.update(removal(fields));
    counts[path] = n;
    console.log(`  ${path} (${fields.join(", ")}): ${n}`);
  }

  if (!confirmed) {
    console.log(`\nNothing changed. To remove them: node scripts/scrubStaffUids.js --confirm ${PROJECT_ID}`);
    return;
  }
  await db.collection("auditLog").add({
    actorId: "owner-script",
    actorRole: "system",
    action: "Removed staff uids and admin notes from records patients or the public can read",
    code: "maintenance.staff_uids_removed",
    category: "security",
    result: "success",
    details: counts,
    timestamp: FieldValue.serverTimestamp(),
  });
  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
