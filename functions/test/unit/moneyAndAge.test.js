// Refund amounts (lib/money.js) and the booking age check (lib/core.js).
// Run: cd functions && npm test

const test = require("node:test");
const assert = require("node:assert/strict");
const { noShowSplit } = require("../../lib/money");
const { patientAge } = require("../../lib/core");
const { renderEmail } = require("../../lib/emailTemplates");

test("no-show refund: the hospital keeps forfeitPercent, the rest goes back", () => {
  assert.deepEqual(noShowSplit(150, 20), { kept: 30, refund: 120 });
  assert.deepEqual(noShowSplit(150, 0), { kept: 0, refund: 150 });
  assert.deepEqual(noShowSplit(150, 100), { kept: 150, refund: 0 });
});

test("no-show refund: kept + refund always equal what was paid (to the pesewa)", () => {
  for (const paid of [99.99, 100.01, 150, 333.33, 1]) {
    for (const pct of [0, 7, 20, 33, 50, 99, 100]) {
      const { kept, refund } = noShowSplit(paid, pct);
      assert.equal(Math.round((kept + refund) * 100), Math.round(paid * 100), `${paid} @ ${pct}%`);
      assert.ok(refund >= 0 && kept >= 0);
    }
  }
});

test("no-show refund: nonsense input is clamped, never negative", () => {
  assert.deepEqual(noShowSplit(-50, 20), { kept: 0, refund: 0 });
  assert.deepEqual(noShowSplit(100, 150), { kept: 100, refund: 0 });
  assert.deepEqual(noShowSplit(100, -10), { kept: 0, refund: 100 });
  assert.deepEqual(noShowSplit(undefined, undefined), { kept: 0, refund: 0 });
});

test("the patient's no-show email quotes the same refund", () => {
  const { text } = renderEmail("patient_no_show", {
    scheduledAt: Date.UTC(2026, 9, 10, 10, 0),
    type: "OPD",
    mode: "online",
    consultationId: "HFC-TEST",
    amountPaid: 150,
    noShow: { waitMinutes: 5, rescheduleFee: 50, forfeitPercent: 20 },
  });
  assert.match(text, /GHS 120 of the GHS 150 you paid \(20% is kept/);
});

test("age: whole years, months only under 2", () => {
  assert.deepEqual(patientAge(34), { years: 34, months: null });
  assert.deepEqual(patientAge("2"), { years: 2, months: null });
  assert.deepEqual(patientAge(1, 4), { years: 1, months: 4 });
  assert.deepEqual(patientAge(0, 0), { years: 0, months: 0 });
});

test("age: invalid values are refused", () => {
  for (const [y, m] of [[-1], [121], [3.5], ["abc"], [1], [1, 12], [0, -1], [null]]) {
    assert.throws(() => patientAge(y, m), /age/i, `${y}/${m}`);
  }
});
