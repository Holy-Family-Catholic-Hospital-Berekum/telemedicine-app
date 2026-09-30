// functions/legalDocs.js
//
// Callable `updateLegalDocument`: the only way the terms / privacy text can be
// changed. Checks the caller is an admin, validates the text, archives the
// previous version and writes an audit entry, all in one transaction.
//
// Export it from functions/index.js:
//   exports.updateLegalDocument = require("./legalDocs").updateLegalDocument;
//
// ADJUST TO YOUR PROJECT:
//   - assertAdmin(): swap in the admin check your other callables use.
//   - the auditLog entry: match the field names AuditPanel expects.
//   - CommonJS is used here; convert to `import` if your functions use ESM.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const db = getFirestore();

const DOC_LABELS = { terms: "Terms of service", privacy: "Privacy policy" };
const ID_RE = /^[a-z0-9-]{1,60}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIMITS = { intro: 1000, title: 120, body: 8000, sections: 40, email: 254 };

async function assertAdmin(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to continue.");
  }
  const snap = await db.collection("adminUsers").doc(request.auth.uid).get();
  if (!snap.exists) {
    throw new HttpsError("permission-denied", "Only administrators can do this.");
  }
}

function text(value, max, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpsError("invalid-argument", `${label} can't be empty.`);
  }
  if (value.length > max) {
    throw new HttpsError("invalid-argument", `${label} is too long (limit ${max} characters).`);
  }
  return value.trim();
}

function validate(data) {
  if (!DOC_LABELS[data?.docId]) {
    throw new HttpsError("invalid-argument", "Unknown document.");
  }
  const intro = text(data.intro, LIMITS.intro, "The introduction");
  const contactEmail = text(data.contactEmail, LIMITS.email, "The contact email");
  if (!EMAIL_RE.test(contactEmail)) {
    throw new HttpsError("invalid-argument", "Enter a valid contact email address.");
  }

  if (!Array.isArray(data.sections) || data.sections.length === 0) {
    throw new HttpsError("invalid-argument", "Keep at least one section.");
  }
  if (data.sections.length > LIMITS.sections) {
    throw new HttpsError("invalid-argument", `The limit is ${LIMITS.sections} sections.`);
  }

  const seen = new Set();
  const sections = data.sections.map((s, i) => {
    const id = typeof s?.id === "string" ? s.id : "";
    if (!ID_RE.test(id) || seen.has(id)) {
      throw new HttpsError("invalid-argument", `Section ${i + 1} has an invalid or repeated id.`);
    }
    seen.add(id);
    return {
      id,
      title: text(s.title, LIMITS.title, `Section ${i + 1} title`),
      body: text(s.body, LIMITS.body, `Section ${i + 1} text`),
    };
  });

  return { docId: data.docId, intro, contactEmail, sections };
}

exports.updateLegalDocument = onCall({ region: "europe-west1" }, async (request) => {
  await assertAdmin(request);
  const { docId, ...clean } = validate(request.data);

  const ref = db.collection("legalDocs").doc(docId);
  const version = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const previous = snap.exists ? snap.data().version || 0 : 0;
    const next = previous + 1;

    // Keep what was live before, so any past wording can be recovered.
    if (snap.exists) {
      tx.set(ref.collection("versions").doc(String(previous)), {
        ...snap.data(),
        archivedAt: FieldValue.serverTimestamp(),
      });
    }

    tx.set(ref, {
      ...clean,
      version: next,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: request.auth.uid,
    });

    tx.set(db.collection("auditLog").doc(), {
      action: "Changed legal text",
      targetId: DOC_LABELS[docId],
      actorId: request.auth.uid,
      timestamp: FieldValue.serverTimestamp(),
    });

    return next;
  });

  return { ok: true, version };
});
