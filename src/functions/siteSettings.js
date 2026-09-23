/**
 * functions/siteSettings.js
 * Server side of the admin Control Panel.
 *
 * ── WHAT THIS PROTECTS ───────────────────────────────────────────────
 * Prices decide how much patients are charged, so they can't be writable
 * from a browser. Firestore rules make siteSettings read-only to clients;
 * the only writers are the two callables below, and both start with
 * requireAdmin(), which checks adminUsers/{uid} on the server (architecture
 * 6.1: privileges are checked against adminUsers, never trusted from the
 * browser). Doctors also live in adminUsers, so the check is on `role`.
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
 * ── HOOKING IT UP (functions/index.js) ───────────────────────────────
 * See INTEGRATION.md. index.js requires this file AFTER admin.initializeApp().
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

// Keep in step with FUNCTIONS_REGION in the client and setGlobalOptions.
const REGION = "europe-west1";

// The value stored in adminUsers/{uid}.role for administrators.
// ASSUMPTION: "admin" (that is what the Users tab uses). Change it if your
// adminUsers documents use another string.
const ADMIN_ROLE = "admin";

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

const getDb = () => admin.firestore();
const settingsDoc = () => getDb().doc("siteSettings/public");
const SERVER_TIME = () => admin.firestore.FieldValue.serverTimestamp();

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

async function requireAdmin(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Please sign in to continue.");
  }
  const snap = await getDb().collection("adminUsers").doc(request.auth.uid).get();
  if (!snap.exists || snap.data().role !== ADMIN_ROLE) {
    throw new HttpsError(
      "permission-denied",
      "Only administrators can change these settings.",
    );
  }
  // MFA: architecture 6.2 requires it for staff. It is switched off in
  // signIn.jsx for now; when you turn it back on, also enforce it here:
  //   if (!request.auth.token.firebase?.sign_in_second_factor) {
  //     throw new HttpsError("permission-denied", "Sign in with MFA to continue.");
  //   }
  return request.auth.uid;
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

exports.loadPrices = loadPrices;
exports.DEFAULT_FEES = DEFAULT_FEES;
