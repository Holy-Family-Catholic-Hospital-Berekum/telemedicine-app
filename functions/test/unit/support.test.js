// Support messages: office hours, the "we'll reply when we open" email,
// message text clean-up and the support emails (lib/support.js,
// lib/emailTemplates.js). Hospital time is UTC.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isOfficeOpen,
  nextOpening,
  needsAfterHoursNotice,
  cleanText,
  preview,
} = require("../../lib/support");
const { renderEmail } = require("../../lib/emailTemplates");

const at = (iso) => new Date(iso);
// 2 Nov 2026 is a Monday.

test("office hours are Monday to Friday, 08:00 to 17:00 Ghana time", () => {
  assert.equal(isOfficeOpen(at("2026-11-02T08:00:00Z")), true);
  assert.equal(isOfficeOpen(at("2026-11-02T16:59:59Z")), true);
  assert.equal(isOfficeOpen(at("2026-11-02T17:00:00Z")), false);
  assert.equal(isOfficeOpen(at("2026-11-02T07:59:59Z")), false);
  assert.equal(isOfficeOpen(at("2026-11-06T12:00:00Z")), true); // Friday
  assert.equal(isOfficeOpen(at("2026-11-07T12:00:00Z")), false); // Saturday
  assert.equal(isOfficeOpen(at("2026-11-08T12:00:00Z")), false); // Sunday
});

test("the next opening skips the evening and the weekend", () => {
  const open = at("2026-11-03T10:00:00Z");
  assert.equal(nextOpening(open), open);
  assert.equal(nextOpening(at("2026-11-03T06:30:00Z")).toISOString(), "2026-11-03T08:00:00.000Z");
  assert.equal(nextOpening(at("2026-11-03T19:00:00Z")).toISOString(), "2026-11-04T08:00:00.000Z");
  assert.equal(nextOpening(at("2026-11-06T17:30:00Z")).toISOString(), "2026-11-09T08:00:00.000Z");
  assert.equal(nextOpening(at("2026-11-08T23:59:00Z")).toISOString(), "2026-11-09T08:00:00.000Z");
});

test("the 'we'll reply when we open' email goes once per closed period", () => {
  const friEvening = at("2026-11-06T18:00:00Z");
  assert.equal(needsAfterHoursNotice(at("2026-11-06T10:00:00Z"), undefined), false);
  assert.equal(needsAfterHoursNotice(friEvening, undefined), true);
  const announced = nextOpening(friEvening).getTime();
  // Same weekend: already told.
  assert.equal(needsAfterHoursNotice(at("2026-11-08T09:00:00Z"), announced), false);
  // The next closed period: told again.
  assert.equal(needsAfterHoursNotice(at("2026-11-09T20:00:00Z"), announced), true);
});

test("message text keeps line breaks and drops control characters", () => {
  assert.equal(cleanText("  Hello\r\nthere\u0007\n\n\n\n\nBye  "), "Hello\nthere\n\n\nBye");
  assert.equal(preview("one\n  two"), "one two");
  assert.equal(preview("x".repeat(200)).length, 140);
});

test("the reply email quotes the reply, escaped, with the scam warning", () => {
  const { subject, text, html } = renderEmail("support_reply", {
    scheduledAt: Date.parse("2026-11-02T09:00:00Z"),
    patientName: "Ama Mensah",
    topic: "payment",
    reply: "Your refund is on its way.\n<script>alert(1)</script>",
  });
  assert.match(subject, /replied/);
  assert.match(text, /^Hello Ama,/);
  assert.match(text, /> Your refund is on its way\./);
  assert.match(text, /Payment or refund/);
  assert.match(text, /never ask for your mobile money PIN/);
  assert.match(text, /\/dashboard#support/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("the after-hours email says when we open", () => {
  const { text } = renderEmail("support_after_hours", {
    scheduledAt: Date.parse("2026-11-06T18:00:00Z"),
    patientName: "Ama",
    topic: "booking",
    opensAt: Date.parse("2026-11-09T08:00:00Z"),
  });
  assert.match(text, /We open: Monday,? 9 November 2026 at 08:00/);
  assert.match(text, /Monday to Friday, 8:00 am to 5:00 pm/);
});

test("the admin email has no patient name and no message text", () => {
  const { text, html } = renderEmail("admin_support_message", {
    scheduledAt: Date.parse("2026-11-02T09:00:00Z"),
    topic: "video_call",
    reopened: false,
  });
  assert.match(text, /Joining a video call/);
  assert.match(text, /Customer support/);
  assert.doesNotMatch(html, /href=/); // no link to the staff portal
});
