// Caller address for per-IP limits, consent and audit (lib/core.js clientIp):
// the address Google appended, never one the caller wrote.
// Run: cd functions && npm test

const test = require("node:test");
const assert = require("node:assert/strict");
const { clientIp } = require("../../lib/core");

const req = (forwardedFor, ip = "10.0.0.9") => ({ headers: { "x-forwarded-for": forwardedFor }, ip });

test("Google's appended address is used, not one the caller made up", () => {
  assert.equal(clientIp(req("203.0.113.7")), "203.0.113.7");
  assert.equal(clientIp(req("1.2.3.4, 203.0.113.7")), "203.0.113.7");
  assert.equal(clientIp(req("9.9.9.9,8.8.8.8 , 203.0.113.7")), "203.0.113.7");
});

test("without the header, falls back to the connection's address", () => {
  assert.equal(clientIp(req(undefined)), "10.0.0.9");
  assert.equal(clientIp(req("")), "10.0.0.9");
  assert.equal(clientIp(undefined), null);
});
