// Email service adapters (lib/mailProvider.js), with the network faked.
// Run: cd functions && npm test

process.env.MAIL_PROVIDER = "brevo";
process.env.BREVO_API_KEY = "test-key";

const test = require("node:test");
const assert = require("node:assert/strict");
const { send, parseAddress, PROVIDER } = require("../../lib/mailProvider");

function fakeFetch(status, json) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  return calls;
}

const message = {
  id: "mail123",
  kind: "patient_reminder",
  from: "Holy Family Catholic Hospital <appointments@mail.hfhberekum.org>",
  to: "patient@example.test",
  replyTo: null,
  subject: "Your appointment",
  text: "Plain text",
  html: "<p>Hi</p>",
};

test("addresses: 'Name <email>' is split for Brevo", () => {
  assert.deepEqual(parseAddress("Holy Family <a@b.org>"), { name: "Holy Family", email: "a@b.org" });
  assert.deepEqual(parseAddress("a@b.org"), { email: "a@b.org" });
});

test("Brevo: the request carries sender, recipient, both bodies and the key", async () => {
  assert.equal(PROVIDER, "brevo");
  const calls = fakeFetch(201, { messageId: "<abc@smtp-relay.mailin.fr>" });
  const r = await send(message);
  assert.deepEqual(r, { ok: true, status: 201, providerId: "<abc@smtp-relay.mailin.fr>", error: "" });
  const { url, init, body } = calls[0];
  assert.equal(url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(init.headers["api-key"], "test-key");
  assert.deepEqual(body.sender, { name: "Holy Family Catholic Hospital", email: "appointments@mail.hfhberekum.org" });
  assert.deepEqual(body.to, [{ email: "patient@example.test" }]);
  assert.equal(body.textContent, "Plain text");
  assert.equal(body.htmlContent, "<p>Hi</p>");
  assert.equal(body.replyTo, undefined); // no-reply (hospital decision)
  assert.deepEqual(body.tags, ["patient_reminder"]);
});

test("Brevo: errors come back with status and message (email.js decides retry)", async () => {
  fakeFetch(400, { code: "invalid_parameter", message: "email is not valid" });
  assert.deepEqual(await send(message), { ok: false, status: 400, providerId: null, error: "email is not valid" });
  fakeFetch(429, { code: "too_many_requests" });
  assert.equal((await send(message)).status, 429);
});

test("Brevo: network failure is status 0 (temporary, retried)", async () => {
  global.fetch = async () => {
    throw new Error("socket hang up");
  };
  const r = await send(message);
  assert.equal(r.ok, false);
  assert.equal(r.status, 0);
  assert.match(r.error, /socket hang up/);
});
