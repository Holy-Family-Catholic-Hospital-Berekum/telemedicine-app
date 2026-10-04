/**
 * functions/siteSettings.js
 * Server side of the admin Control Panel.
 *
 * ── WHAT THIS PROTECTS ───────────────────────────────────────────────
 * Prices decide how much patients are charged, so they can't be writable
 * from a browser. Firestore rules make siteSettings read-only to clients;
 * the only writers are the two callables below, and both start with
 * requireAdmin(), which checks the signed `role` claim and an active
 * adminUsers profile on the server, never anything the browser says.
 *
 * Images are uploaded straight to Storage by the browser (Storage rules
 * allow admins only), then the browser calls updateSiteImages with the
 * storage PATHS. We never trust a URL from the client: we confirm each file
 * really exists in our bucket, is an image and is small, then build the URL
 * ourselves.
 *
 * Every change writes an auditLog entry (actorId, action, targetId,
 * timestamp — same shape as section 5 of the architecture).
 *
 * index.js re-exports updateConsultationPrices and updateSiteImages.
 */

const { HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { onCall, admin, db, FieldValue, REGION, requireRole } = require("./lib/core");

// Fallback fees, used until an admin sets prices. Keep in step with
// DEFAULT_PRICES in src/siteSettings.js.
const DEFAULT_FEES = { OPD: 250, SURGICAL: 300 };
const FEE_LABELS = { OPD: "General OPD", SURGICAL: "Surgical" };
const MAX_FEE = 5000; // typo guard: 2500 instead of 250 is refused

const MAX_SLIDES = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const SLOT_FIELD = { hero: "heroImage", auth: "authImage" };
const SLOT_LABEL = {
  hero: "Home page photo",
  auth: "Sign-in and sign-up photo",
  slider: "Side panel slideshow",
};
const PATH_RE = /^siteAssets\/(hero|auth|slider)\/[\w.-]+\.jpg$/;

const getDb = () => db;
const settingsDoc = () => getDb().doc("siteSettings/public");
const SERVER_TIME = () => FieldValue.serverTimestamp();

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

async function requireAdmin(request) {
  // Signed role claim plus an active adminUsers profile (lib/core.js).
  const caller = await requireRole(request, ["admin"]);
  return caller.uid;
}

/** Pull valid prices out of a settings document, falling back per type. */
function readPrices(data) {
  const p = data?.prices || {};
  const out = {};
  for (const type of Object.keys(DEFAULT_FEES)) {
    const n = p[type];
    out[type] = typeof n === "number" && Number.isFinite(n) && n > 0 ? n : DEFAULT_FEES[type];
  }
  return out;
}

/** Current fees. createBookingDraft calls this instead of a hard-coded table. */
async function loadPrices() {
  const snap = await settingsDoc().get();
  return readPrices(snap.exists ? snap.data() : null);
}

function publicUrl(bucketName, path) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media`;
}

/** Confirms an uploaded file is real, ours, and an image; returns {path,url}. */
async function describeImage(bucket, path, expectedFolder) {
  if (typeof path !== "string" || !PATH_RE.test(path) || !path.startsWith(`siteAssets/${expectedFolder}/`)) {
    throw new HttpsError("invalid-argument", "That image path isn't valid.");
  }
  const file = bucket.file(path);
  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpsError("failed-precondition", "That upload didn't arrive. Please try again.");
  }
  const [meta] = await file.getMetadata();
  const isImage = String(meta.contentType || "").startsWith("image/");
  if (!isImage || Number(meta.size) > MAX_IMAGE_BYTES) {
    await file.delete({ ignoreNotFound: true }).catch(() => {});
    throw new HttpsError("invalid-argument", "That file isn't a valid image.");
  }
  return { path, url: publicUrl(bucket.name, path) };
}

/* ------------------------------------------------------------------ */
/* updateConsultationPrices                                            */
/* ------------------------------------------------------------------ */

/**
 * data: { OPD: number, SURGICAL: number }  (both required, in GHS)
 * Bookings already created keep the amount they were created with (the fee
 * is copied onto the booking in createBookingDraft), so a price change never
 * alters what a patient mid-payment is asked for.
 */
exports.updateConsultationPrices = onCall({ region: REGION }, async (request) => {
  const uid = await requireAdmin(request);
  const d = request.data || {};

  const next = {};
  for (const type of Object.keys(DEFAULT_FEES)) {
    const n = d[type];
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > MAX_FEE) {
      throw new HttpsError(
        "invalid-argument",
        `Enter a fee between 1 and ${MAX_FEE} for ${FEE_LABELS[type]}.`,
      );
    }
    next[type] = Math.round(n * 100) / 100;
  }

  const ref = settingsDoc();
  const db = getDb();
  const changes = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const before = readPrices(snap.exists ? snap.data() : null);
    const changed = Object.keys(next).filter((t) => next[t] !== before[t]);
    if (changed.length === 0) return [];

    tx.set(
      ref,
      { prices: next, updatedAt: SERVER_TIME(), updatedBy: uid },
      { merge: true },
    );
    tx.set(db.collection("auditLog").doc(), {
      actorId: uid,
      action: "Changed consultation prices",
      targetId: changed.map((t) => `${FEE_LABELS[t]} ${before[t]} to ${next[t]}`).join("; "),
      timestamp: SERVER_TIME(),
    });
    return changed;
  });

  return { changed: changes.length > 0, prices: next };
});

/* ------------------------------------------------------------------ */
/* updateSiteImages                                                    */
/* ------------------------------------------------------------------ */

/**
 * data (send only the slots you are changing):
 *   hero:   "siteAssets/hero/…jpg"  | null   (null = back to the built-in photo)
 *   auth:   "siteAssets/auth/…jpg"  | null
 *   slider: ["siteAssets/slider/…jpg", …] (1–8, in display order) | null
 *
 * Files that stop being used are deleted from Storage afterwards.
 */
exports.updateSiteImages = onCall({ region: REGION }, async (request) => {
  const uid = await requireAdmin(request);
  const d = request.data || {};

  const slots = ["hero", "auth", "slider"].filter((s) => s in d);
  if (slots.length === 0) {
    throw new HttpsError("invalid-argument", "Nothing to update.");
  }

  const bucket = admin.storage().bucket();
  const next = {}; // Firestore field -> new value

  for (const slot of slots) {
    if (slot === "slider") {
      if (d.slider === null) {
        next.sliderImages = [];
        continue;
      }
      const paths = d.slider;
      if (!Array.isArray(paths) || paths.length < 1 || paths.length > MAX_SLIDES) {
        throw new HttpsError("invalid-argument", `Choose between 1 and ${MAX_SLIDES} photos.`);
      }
      if (new Set(paths).size !== paths.length) {
        throw new HttpsError("invalid-argument", "The same photo was added twice.");
      }
      next.sliderImages = await Promise.all(paths.map((p) => describeImage(bucket, p, "slider")));
    } else {
      next[SLOT_FIELD[slot]] = d[slot] === null ? null : await describeImage(bucket, d[slot], slot);
    }
  }

  const ref = settingsDoc();
  const db = getDb();
  let removed = [];

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const before = snap.exists ? snap.data() : {};
    removed = []; // a retried transaction must start from scratch

    for (const [field, value] of Object.entries(next)) {
      const oldPaths =
        field === "sliderImages"
          ? (before.sliderImages || []).map((i) => i.path)
          : [before[field]?.path];
      const newPaths =
        field === "sliderImages" ? value.map((i) => i.path) : [value?.path];
      for (const p of oldPaths) {
        if (p && !newPaths.includes(p)) removed.push(p);
      }
    }

    tx.set(ref, { ...next, updatedAt: SERVER_TIME(), updatedBy: uid }, { merge: true });
    tx.set(db.collection("auditLog").doc(), {
      actorId: uid,
      action: "Changed site images",
      targetId: slots.map((s) => SLOT_LABEL[s]).join(", "),
      timestamp: SERVER_TIME(),
    });
  });

  // Clean up after the commit. Best effort: an orphaned file costs almost
  // nothing, and failing here must not fail a change that already saved.
  await Promise.all(
    removed
      .filter((p) => PATH_RE.test(p))
      .map((p) =>
        bucket
          .file(p)
          .delete({ ignoreNotFound: true })
          .catch((err) => logger.warn("Could not delete old site image", { path: p, err })),
      ),
  );

  return { ok: true };
});

/* ------------------------------------------------------------------ */
/* updateDoctorSelection                                               */
/* ------------------------------------------------------------------ */

/**
 * data: { enabled: boolean }
 * Whether patients may pick a specific doctor when booking. When off, the
 * booking page hides the picker, the home page hides "Book this doctor",
 * and createBookingDraft ignores any doctor sent (open slots still carry
 * their doctor, since an admin created them).
 */
exports.updateDoctorSelection = onCall({ region: REGION }, async (request) => {
  const uid = await requireAdmin(request);
  const enabled = request.data?.enabled;
  if (typeof enabled !== "boolean") {
    throw new HttpsError("invalid-argument", "Choose on or off.");
  }
  const db = getDb();
  const batch = db.batch();
  batch.set(
    settingsDoc(),
    { doctorSelectionEnabled: enabled, updatedAt: SERVER_TIME(), updatedBy: uid },
    { merge: true },
  );
  batch.set(db.collection("auditLog").doc(), {
    actorId: uid,
    actorRole: "admin",
    action: enabled
      ? "Allowed patients to choose their doctor"
      : "Stopped patients choosing their doctor",
    code: "settings.doctor_selection",
    category: "account",
    targetId: "Doctor selection",
    result: "success",
    timestamp: SERVER_TIME(),
  });
  await batch.commit();
  return { enabled };
});

/** Missing setting = allowed (the original behaviour). */
async function doctorSelectionEnabled() {
  const snap = await settingsDoc().get();
  return !(snap.exists && snap.data().doctorSelectionEnabled === false);
}

exports.doctorSelectionEnabled = doctorSelectionEnabled;
exports.loadPrices = loadPrices;
exports.DEFAULT_FEES = DEFAULT_FEES;
