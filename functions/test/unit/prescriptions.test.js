// Prescription rules (lib/prescriptions.js) and the PDF form
// (lib/prescriptionPdf.js). Run: cd functions && npm test

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  validatePrescription,
  cannotIssueReason,
  mdcNumber,
  signaturePng,
  requireFreshSignIn,
  normaliseCheckCode,
  newCheckCode,
  newPrescriptionId,
  ageText,
} = require("../../lib/prescriptions");
const { buildPrescriptionPdf, pdfSafe, checkUrl } = require("../../lib/prescriptionPdf");

const HOUR = 3600 * 1000;
const item = { medicine: "Amoxicillin", strength: "500 mg", form: "capsule", dose: "1 capsule", frequency: "Three times a day", duration: "7 days", quantity: "21" };
const met = (msAgo, extra = {}) => ({ mode: "online", status: "in_progress", metAt: new Date(Date.now() - msAgo), ...extra });
// A real 1x1 PNG.
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("prescription: medicine lines are trimmed; optional fields become null", () => {
  const { items, notes } = validatePrescription({
    items: [{ medicine: " Paracetamol ", dose: "1 g", frequency: "Every 6 hours", duration: "3 days" }],
  });
  assert.deepEqual(items, [{
    medicine: "Paracetamol", strength: null, form: null, dose: "1 g",
    frequency: "Every 6 hours", duration: "3 days", quantity: null,
  }]);
  assert.equal(notes, null);
});

test("prescription: no medicines, too many, or a missing dose is refused", () => {
  assert.throws(() => validatePrescription({ items: [] }), /at least one/);
  assert.throws(() => validatePrescription({}), /at least one/);
  assert.throws(() => validatePrescription({ items: Array(11).fill(item) }), /up to 10/);
  assert.throws(() => validatePrescription({ items: [{ ...item, dose: "" }] }), /Dose/);
  assert.throws(() => validatePrescription({ items: [{ ...item, medicine: "x".repeat(101) }] }), /too long/);
});

test("prescription: characters the form can't print are refused", () => {
  assert.throws(() => validatePrescription({ items: [{ ...item, medicine: "<script>" }] }), /can't print/);
  assert.throws(() => validatePrescription({ items: [{ ...item, dose: "1\u0000" }] }), /can't print/);
  assert.throws(() => validatePrescription({ items: [{ ...item, medicine: "药" }] }), /can't print/);
  assert.doesNotThrow(() => validatePrescription({ items: [{ ...item, strength: "250 mg/5 mL", dose: "5 µg" }] }));
});

test("issuing: video calls only, after the two met, within 24 hours, once", () => {
  assert.equal(cannotIssueReason(met(HOUR)), null);
  assert.match(cannotIssueReason(met(HOUR, { mode: "in_person" })), /LHIMS/);
  assert.match(cannotIssueReason({ mode: "online", status: "scheduled" }), /connected/);
  assert.match(cannotIssueReason(met(25 * HOUR)), /24 hours/);
  assert.match(cannotIssueReason(met(HOUR, { prescription: { id: "RX-1", status: "cancelled" } })), /already/);
  assert.match(cannotIssueReason(met(HOUR, { doctorUnavailable: { kind: "call_incomplete" } })), /didn't take place/);
  assert.match(cannotIssueReason(met(HOUR, { status: "no_show" })), /didn't take place/);
});

test("MDC number: kept in capitals; junk refused", () => {
  assert.equal(mdcNumber(" mdc/rn/12345 "), "MDC/RN/12345");
  assert.throws(() => mdcNumber("<b>"), /MDC/);
  assert.throws(() => mdcNumber(""), /required/);
});

test("signature: a real small PNG is accepted (with or without the data: prefix)", () => {
  const a = signaturePng(PNG_1PX);
  const b = signaturePng(`data:image/png;base64,${PNG_1PX}`);
  assert.equal(a.png, b.png);
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
});

test("signature: anything else is refused", () => {
  assert.throws(() => signaturePng(Buffer.from("GIF89a....").toString("base64")), /valid image/);
  assert.throws(() => signaturePng("not base64!"), /valid image/);
  assert.throws(() => signaturePng(42), /too large/);
  // A PNG header claiming 5000 px wide.
  const big = Buffer.from(PNG_1PX, "base64");
  big.writeUInt32BE(5000, 16);
  assert.throws(() => signaturePng(big.toString("base64")), /wrong size/);
});

test("changing the signature needs a sign-in under 5 minutes old", () => {
  const now = Date.now();
  assert.doesNotThrow(() => requireFreshSignIn({ auth_time: now / 1000 - 60 }, now));
  assert.throws(() => requireFreshSignIn({ auth_time: now / 1000 - 600 }, now), /password and authenticator/);
  assert.throws(() => requireFreshSignIn({}, now), /password and authenticator/);
});

test("check codes: 20 characters, typed codes normalised, junk refused", () => {
  const code = newCheckCode();
  assert.match(code, /^[23456789A-HJKMNP-Z]{20}$/);
  assert.equal(normaliseCheckCode(code.toLowerCase().replace(/(.{5})/g, "$1-")), code);
  assert.equal(normaliseCheckCode("ABC"), null);
  assert.equal(normaliseCheckCode("O".repeat(20)), null); // no O/0/1/I/L
  assert.equal(normaliseCheckCode({}), null);
  assert.match(newPrescriptionId(), /^RX-[23456789A-HJKMNP-Z]{10}$/);
});

test("age on the form", () => {
  assert.equal(ageText({ age: { years: 34, months: null } }), "34 years");
  assert.equal(ageText({ age: { years: 1, months: 4 } }), "1 year 4 months");
  assert.equal(ageText({ age: { years: 0, months: 1 } }), "1 month");
  assert.equal(ageText({}), null);
  assert.equal(ageText(null), null);
});

test("PDF text: Ghanaian letters folded, nothing unprintable left", () => {
  assert.equal(pdfSafe("Ɛfua Ɔsei Ŋkansa"), "Efua Osei Nkansa");
  assert.equal(pdfSafe("Adwoa Asantewaa"), "Adwoa Asantewaa");
  assert.equal(pdfSafe("Zoë"), "Zoë");
  assert.equal(pdfSafe("药"), "?");
  assert.equal(pdfSafe(null), "");
});

test("the QR opens the check page with the code in the #fragment", () => {
  assert.match(checkUrl("ABC"), /\/check-prescription#ABC$/);
});

test("the form builds as a PDF with the reference in it", async () => {
  const sig = fs.readFileSync(path.join(__dirname, "..", "..", "assets", "hospital-logo.png")).toString("base64");
  const pdf = await buildPrescriptionPdf({
    id: "RX-TEST234567",
    checkCode: newCheckCode(),
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * 24 * HOUR),
    patientName: "Ama Owusu",
    guardianName: null,
    patientAge: "34 years",
    patientSex: "female",
    doctorName: "Dr. Test",
    doctorDepartment: "General Practice",
    doctorMdcNumber: "MDC/RN/1",
    items: Array(10).fill(item),
    notes: "After meals.",
  }, sig);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 5000);
});

test("admin reschedule: a missed call or one that couldn't be completed, not one that took place", () => {
  const { adminCanReschedule } = require("../../scheduling");
  assert.equal(adminCanReschedule({}), true);
  assert.equal(adminCanReschedule({ metAt: new Date() }), false);
  assert.equal(adminCanReschedule({ metAt: new Date(), doctorUnavailable: { kind: "call_incomplete" } }), true);
  assert.equal(adminCanReschedule({ doctorUnavailable: { kind: "doctor_absent" } }), true);
});

test("signature is cropped to its ink so it sits on the line", () => {
  const { PNG } = require("pngjs");
  const { cropToInk } = require("../../lib/prescriptionPdf");
  const png = new PNG({ width: 600, height: 200 });
  for (let x = 200; x < 300; x++) png.data[(100 * 600 + x) * 4 + 3] = 255; // one stroke
  const out = PNG.sync.read(cropToInk(PNG.sync.write(png).toString("base64")));
  assert.ok(out.width <= 110 && out.height <= 10, `${out.width}x${out.height}`);
  // Something that isn't a PNG is passed through untouched.
  assert.equal(cropToInk(Buffer.from("x").toString("base64")).toString(), "x");
});
