// Payment references (lib/paystack.js): live and test never claim each
// other's payments. Run: cd functions && npm test

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

const check = (env) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        "-e",
        `const p = require("./lib/paystack");
         const own = p.newReference("abc123");
         console.log(JSON.stringify({ own, ownOk: p.isOurReference(own),
           live: p.isOurReference("HFH-ABCDEF-abc123"), test: p.isOurReference("HFT-ABCDEF-abc123"),
           bad: p.isOurReference("HFH-ABCDEF-../x") }));`,
      ],
      { cwd: `${__dirname}/../..`, env: { ...process.env, ...env } },
    ).toString(),
  );

test("live (default): HFH references only", () => {
  const r = check({ PAYMENT_REF_PREFIX: "" });
  assert.match(r.own, /^HFH-[2-9A-Z]{6}-abc123$/);
  assert.deepEqual([r.ownOk, r.live, r.test, r.bad], [true, true, false, false]);
});

test("test project: HFT references only", () => {
  const r = check({ PAYMENT_REF_PREFIX: "HFT" });
  assert.match(r.own, /^HFT-[2-9A-Z]{6}-abc123$/);
  assert.deepEqual([r.ownOk, r.live, r.test, r.bad], [true, false, true, false]);
});
