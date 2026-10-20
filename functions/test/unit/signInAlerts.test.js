// New-device sign-in emails (lib/signInAlerts.js) and the scam warning on
// patient emails (lib/emailTemplates.js).
// Run: cd functions && npm test

const test = require("node:test");
const assert = require("node:assert/strict");
const { describeDevice, validDeviceId } = require("../../lib/signInAlerts");
const { renderEmail } = require("../../lib/emailTemplates");

test("describes common browsers and phones in plain words", () => {
  assert.equal(
    describeDevice("Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36"),
    "Chrome on Android",
  );
  assert.equal(
    describeDevice("Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36"),
    "Samsung Internet on Android",
  );
  assert.equal(
    describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"),
    "Safari on iPhone",
  );
  assert.equal(
    describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0"),
    "Edge on Windows",
  );
  assert.equal(describeDevice(""), "An unknown device");
  assert.equal(describeDevice(null), "An unknown device");
});

test("only accepts device ids the browser could have made", () => {
  assert.equal(validDeviceId("AbCdEfGhIjKlMnOpQrStUvWx"), true);
  assert.equal(validDeviceId("short"), false);
  assert.equal(validDeviceId("has spaces in it, not allowed!!"), false);
  assert.equal(validDeviceId("x".repeat(65)), false);
  assert.equal(validDeviceId(undefined), false);
  assert.equal(validDeviceId({ id: "AbCdEfGhIjKlMnOpQrStUvWx" }), false);
});

const signInAt = Date.UTC(2026, 9, 20, 14, 5);

test("patient new sign-in email: device, time, how to change the password, scam warning", () => {
  const { subject, text, html } = renderEmail("security_new_sign_in", {
    scheduledAt: signInAt,
    name: "Ama Mensah",
    device: "Chrome on Android",
    audience: "patient",
  });
  assert.equal(subject, "New sign-in to your Holy Family account");
  assert.match(text, /Hello Ama,/);
  assert.match(text, /Device: Chrome on Android/);
  assert.match(text, /14:05 \(Ghana time\)/);
  assert.match(text, /Forgot password\?/);
  assert.match(text, /\/signin/);
  assert.match(text, /we only take payment on our website/);
  assert.doesNotMatch(text, /you booked a consultation/);
  assert.match(html, /Chrome on Android/);
});

test("staff new sign-in email has no link and no patient scam text", () => {
  const { text, html } = renderEmail("security_new_sign_in", {
    scheduledAt: signInAt,
    name: "Kofi Owusu",
    device: "Firefox on Windows",
    audience: "staff",
  });
  assert.match(text, /tell the IT team or an admin/);
  assert.match(text, /never ask you for your password or your authenticator code/);
  assert.doesNotMatch(text, /https?:\/\//);
  assert.doesNotMatch(html, /<a /);
  assert.doesNotMatch(text, /we only take payment/);
});

test("every patient appointment email carries the scam warning; doctor and admin emails don't", () => {
  const base = { scheduledAt: signInAt, type: "OPD", mode: "online", doctorName: "Dr A", patientName: "Ama", consultationId: "HFC-ABCDEFGHIJ" };
  assert.match(renderEmail("appointment_scheduled", base).text, /We will never call, text or WhatsApp you/);
  assert.match(renderEmail("patient_no_show", base).text, /We will never call, text or WhatsApp you/);
  assert.doesNotMatch(renderEmail("doctor_assigned", base).text, /We will never call, text or WhatsApp you/);
  assert.doesNotMatch(
    renderEmail("admin_new_booking", { ...base, amount: 100, bookingId: "b1" }).text,
    /We will never call, text or WhatsApp you/,
  );
});
