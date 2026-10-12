// Website error reports (clientErrors.js): nothing personal gets logged.
// Run: cd functions && npm test

const test = require("node:test");
const assert = require("node:assert/strict");
const { scrub } = require("../../clientErrors");

test("emails, phone numbers and booking references are removed", () => {
  const out = scrub("Failed for ama.mensah@gmail.com, call 024 123 4567 about HFC-AB12CD34EF", 300);
  assert.equal(out, "Failed for [email], call [number] about [reference]");
});

test("long token-like strings are removed; length is capped", () => {
  assert.equal(scrub("token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef end", 300), "token [redacted] end");
  assert.equal(scrub("word ".repeat(100), 300).length, 300);
});

test("ordinary error text is kept", () => {
  const msg = "TypeError: Cannot read properties of undefined (reading 'map') at Home.jsx:120:15";
  assert.equal(scrub(msg, 300), msg);
});
