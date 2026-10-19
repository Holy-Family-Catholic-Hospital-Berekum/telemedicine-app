// functions/lib/prescriptions.js
//
// Rules for prescriptions (prescriptions.js), kept free of Firestore so the
// unit tests can check them.
//
// Hospital decisions (medical director, 19 Oct 2026): the hospital's
// record is LHIMS, where the doctor enters every consultation as for a
// hospital visit. The app only hands the patient a signed prescription:
//   - video consultations only (hospital visits are prescribed in LHIMS),
//     once the doctor and patient were connected (metAt), until
//     ISSUE_WINDOW_HOURS later, and while the consultation is still open
//     (closing it deletes the patient's age and sex);
//   - one per consultation; the doctor can cancel it (the check page then
//     says so) but not edit it or write another;
//   - the patient can download it for VALID_DAYS days, then it's deleted
//     (only an audit line stays, without the medicines).

const crypto = require("crypto");
const { HttpsError, str, toDate, randomCode } = require("./core");

const ISSUE_WINDOW_HOURS = 24;
const VALID_DAYS = 7;
const MAX_ITEMS = 10;

// The doctor's drawn signature: a small PNG (signature pad in the
// doctor's Account tab).
const SIGNATURE_MAX_BYTES = 60 * 1024;
const SIGNATURE_MAX_WIDTH = 1200;
const SIGNATURE_MAX_HEIGHT = 600;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Changing the MDC number or signature needs a sign-in (password +
// authenticator) this recent.
const FRESH_SIGN_IN_SECONDS = 5 * 60;

/** New prescription ID, also its printed reference (no 0/O/1/I/L). */
function newPrescriptionId() {
  return `RX-${randomCode(10)}`;
}

/** The code in the QR / typed on the check page: ~99 bits, unguessable. */
function newCheckCode() {
  return randomCode(20);
}

/** Normalises a typed check code (spaces, dashes, lower case). */
function normaliseCheckCode(value) {
  if (typeof value !== "string") return null;
  const code = value.toUpperCase().replace(/[\s-]/g, "");
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{20}$/.test(code) ? code : null;
}

// Letters, digits and the punctuation a prescription needs. No control
// characters, angle brackets or other characters the PDF's built-in fonts
// can't draw.
const TEXT_RE = /^[\p{Script=Latin}0-9 .,;:/()%+\-'"&#*=!?µ]*$/u;

function rxText(value, opts) {
  const s = str(value, opts);
  if (s !== null && !TEXT_RE.test(s)) {
    throw new HttpsError("invalid-argument", `${opts.field} has characters we can't print.`);
  }
  return s;
}

/**
 * The medicine lines and notes the doctor sent, checked and trimmed:
 * { items: [{ medicine, strength, form, dose, frequency, duration,
 * quantity }], notes }.
 */
function validatePrescription(data) {
  const raw = Array.isArray(data?.items) ? data.items : null;
  if (!raw || raw.length === 0) {
    throw new HttpsError("invalid-argument", "Add at least one medicine.");
  }
  if (raw.length > MAX_ITEMS) {
    throw new HttpsError("invalid-argument", `A prescription can have up to ${MAX_ITEMS} medicines.`);
  }
  const items = raw.map((item, i) => {
    const n = i + 1;
    return {
      medicine: rxText(item?.medicine, { field: `Medicine ${n}`, max: 100 }),
      strength: rxText(item?.strength, { field: `Strength (medicine ${n})`, max: 40, optional: true }),
      form: rxText(item?.form, { field: `Form (medicine ${n})`, max: 40, optional: true }),
      dose: rxText(item?.dose, { field: `Dose (medicine ${n})`, max: 60 }),
      frequency: rxText(item?.frequency, { field: `How often (medicine ${n})`, max: 60 }),
      duration: rxText(item?.duration, { field: `How long (medicine ${n})`, max: 40 }),
      quantity: rxText(item?.quantity, { field: `Quantity (medicine ${n})`, max: 40, optional: true }),
    };
  });
  const notes = rxText(data?.notes, { field: "Notes", max: 500, optional: true });
  return { items, notes };
}

/**
 * Why this consultation can't have a prescription now (a message for the
 * doctor), or null if it can.
 */
function cannotIssueReason(c, now = Date.now()) {
  if (c.mode !== "online") {
    return "Prescriptions for hospital visits are written in LHIMS.";
  }
  if (c.prescription) {
    return "This consultation already has a prescription.";
  }
  if (c.status === "no_show" || c.doctorUnavailable) {
    return "This consultation didn't take place, so it can't have a prescription.";
  }
  const met = toDate(c.metAt)?.getTime();
  if (!met) {
    return "You can write a prescription once you and the patient have been connected in the call.";
  }
  if (now > met + ISSUE_WINDOW_HOURS * 3600 * 1000) {
    return `Prescriptions can only be written up to ${ISSUE_WINDOW_HOURS} hours after the consultation.`;
  }
  return null;
}

/** Medical and Dental Council registration number, e.g. "MDC/RN/12345". */
function mdcNumber(value) {
  const s = str(value, { field: "MDC registration number", max: 30, min: 3 });
  if (!/^[A-Za-z0-9][A-Za-z0-9 /.-]*$/.test(s)) {
    throw new HttpsError("invalid-argument", "Enter your MDC registration number as it appears on your certificate.");
  }
  return s.toUpperCase();
}

/**
 * The drawn signature, sent as base64 PNG (with or without the data: URL
 * prefix). Checks it really is a small PNG before anything stores or
 * draws it. Resolves { png (base64), sha256 }.
 */
function signaturePng(value) {
  if (typeof value !== "string" || value.length > SIGNATURE_MAX_BYTES * 2) {
    throw new HttpsError("invalid-argument", "Draw your signature again (it's too large).");
  }
  const b64 = value.replace(/^data:image\/png;base64,/, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    throw new HttpsError("invalid-argument", "That signature isn't a valid image.");
  }
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 33 || buf.length > SIGNATURE_MAX_BYTES || !buf.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new HttpsError("invalid-argument", "That signature isn't a valid image.");
  }
  // IHDR is always the first chunk: width and height at bytes 16-23.
  if (buf.toString("ascii", 12, 16) !== "IHDR") {
    throw new HttpsError("invalid-argument", "That signature isn't a valid image.");
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (!width || !height || width > SIGNATURE_MAX_WIDTH || height > SIGNATURE_MAX_HEIGHT) {
    throw new HttpsError("invalid-argument", "That signature image is the wrong size. Please draw it again.");
  }
  return {
    png: buf.toString("base64"),
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
  };
}

/** Throws unless the caller signed in (password + code) in the last few minutes. */
function requireFreshSignIn(token, now = Date.now()) {
  const age = now / 1000 - Number(token?.auth_time || 0);
  if (!(age >= 0 && age < FRESH_SIGN_IN_SECONDS)) {
    throw new HttpsError(
      "permission-denied",
      "Please confirm with your password and authenticator code, then save again.",
      { reason: "reauth_required" },
    );
  }
}

/** "34 years", "1 year 4 months", "5 months" (null if unknown). */
function ageText(details) {
  const age = details?.age;
  if (age && Number.isInteger(age.years)) {
    if (age.years >= 2) return `${age.years} years`;
    const months = Number.isInteger(age.months) ? age.months : 0;
    const parts = [];
    if (age.years === 1) parts.push("1 year");
    if (months || age.years === 0) parts.push(`${months} month${months === 1 ? "" : "s"}`);
    return parts.join(" ");
  }
  // Older bookings stored a date of birth instead.
  const dob = details?.dateOfBirth ? new Date(details.dateOfBirth) : null;
  if (dob && !Number.isNaN(dob.getTime())) {
    const now = new Date();
    let years = now.getUTCFullYear() - dob.getUTCFullYear();
    if (now.getUTCMonth() < dob.getUTCMonth() ||
      (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())) {
      years -= 1;
    }
    return years >= 0 ? `${years} years` : null;
  }
  return null;
}

module.exports = {
  ISSUE_WINDOW_HOURS,
  VALID_DAYS,
  MAX_ITEMS,
  newPrescriptionId,
  newCheckCode,
  normaliseCheckCode,
  validatePrescription,
  cannotIssueReason,
  mdcNumber,
  signaturePng,
  requireFreshSignIn,
  ageText,
};
