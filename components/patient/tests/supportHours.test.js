// The Help panel's office hours (support/supportHours.js), which must
// match the server's (functions/lib/support.js). 2 Nov 2026 is a Monday.

import test from "node:test";
import assert from "node:assert/strict";
import { isOfficeOpen, nextOpening, openingPhrase } from "../support/supportHours.js";

const at = (iso) => new Date(iso);

test("open Monday to Friday, 8:00 am to 5:00 pm Ghana time", () => {
  assert.equal(isOfficeOpen(at("2026-11-02T08:00:00Z")), true);
  assert.equal(isOfficeOpen(at("2026-11-02T17:00:00Z")), false);
  assert.equal(isOfficeOpen(at("2026-11-07T10:00:00Z")), false);
});

test("tells the patient when we'll reply", () => {
  const early = at("2026-11-03T06:00:00Z");
  assert.equal(openingPhrase(nextOpening(early), early), "today at 8:00 am");
  const evening = at("2026-11-03T18:00:00Z");
  assert.equal(openingPhrase(nextOpening(evening), evening), "tomorrow at 8:00 am");
  const friday = at("2026-11-06T18:00:00Z");
  assert.equal(openingPhrase(nextOpening(friday), friday), "on Monday at 8:00 am");
});
