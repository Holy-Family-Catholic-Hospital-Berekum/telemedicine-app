// Names on audit entries (components/admin/actorName.js).
import { test } from "node:test";
import assert from "node:assert/strict";

import { actorLabel } from "../actorName.js";

const names = new Map([
  ["uid-staff-1", { name: "Dr. Ama Mensah", role: "doctor" }],
  ["uid-no-name", { name: "", role: "patient" }],
]);

test("a loaded account shows its name", () => {
  assert.deepEqual(actorLabel("uid-staff-1", names), { name: "Dr. Ama Mensah", known: true });
});

test("scheduled jobs and scripts show as System", () => {
  assert.deepEqual(actorLabel("system", names), { name: "System", known: true });
  assert.deepEqual(actorLabel("script", names), { name: "System", known: true });
});

test("an account not loaded (or with no name) shows a short ID", () => {
  assert.deepEqual(actorLabel("abcdefghijklmnop", names), { name: "Account abcdefgh…", known: false });
  assert.deepEqual(actorLabel("uid-no-name", names), { name: "Account uid-no-n…", known: false });
  assert.deepEqual(actorLabel("short", undefined), { name: "Account short…", known: false });
});

test("no ID", () => {
  assert.deepEqual(actorLabel(undefined, names), { name: "Unknown", known: false });
  assert.deepEqual(actorLabel("", names), { name: "Unknown", known: false });
});
