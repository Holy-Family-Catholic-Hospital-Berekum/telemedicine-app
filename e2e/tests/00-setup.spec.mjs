// Prepares the emulated hospital: an admin, a doctor with a registered
// room computer, and a 1-minute waiting time so the "who didn't join"
// tests take minutes, not hours. Also proves the staff functions accept
// the robot's staff identity (helpers.mjs) on the emulator.
import { test, expect } from "@playwright/test";
import { seedStaff, callAs, db } from "../helpers.mjs";

test("an admin can change the no-show policy (staff functions work for the robot)", async () => {
  const admin = await seedStaff("admin", "E2E Admin");
  await callAs(admin, "updateNoShowPolicy", { waitMinutes: 1, forfeitPercent: 20, rescheduleFee: 50 });
  const settings = (await db.doc("siteSettings/public").get()).data();
  expect(settings.noShow).toEqual({ waitMinutes: 1, forfeitPercent: 20, rescheduleFee: 50 });
});
