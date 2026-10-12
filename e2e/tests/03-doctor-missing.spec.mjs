// The doctor never comes: the patient waits in the call, the waiting time
// runs out, the call screen apologises, and the patient asks for a full
// refund from the dashboard. Uses a 1-minute waiting time.
import { test, expect } from "@playwright/test";
import {
  createPatient,
  createPaidBooking,
  scheduleWithDoctor,
  signInOnSite,
  seedStaff,
  callAs,
  db,
  waitFor,
  logBrowser,
} from "../helpers.mjs";

test("doctor doesn't join: apology, then a full refund request", async ({ page }) => {
  test.setTimeout(6 * 60 * 1000);
  logBrowser(page);
  const admin = await seedStaff("admin", "E2E Admin");
  await callAs(admin, "updateNoShowPolicy", { waitMinutes: 1, forfeitPercent: 20, rescheduleFee: 50 });

  const patient = await createPatient("Efua Owusu");
  const bookingId = await createPaidBooking(patient);
  const { consultationId } = await scheduleWithDoctor(bookingId, 30 * 1000);

  await signInOnSite(page, patient);
  await page.getByRole("button", { name: "Join call" }).click({ timeout: 60000 });
  await page.getByRole("button", { name: "Everything works: join" }).click({ timeout: 30000 });
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button").last().click();

  // The patient waits; the doctor has until start (or arrival) + 1 minute.
  await waitFor(
    async () => (await db.doc(`consultations/${consultationId}`).get()).data()?.waitDeadline?.for === "doctor",
    { timeout: 60000, what: "the doctor's countdown" },
  );

  // When it runs out, the patient's own check-in settles it: the screen apologises.
  await expect(page.getByText("Your doctor couldn't make it")).toBeVisible({ timeout: 3 * 60 * 1000 });
  const c = (await db.doc(`consultations/${consultationId}`).get()).data();
  expect(c.doctorUnavailable.kind).toBe("doctor_absent");

  // From the dashboard the patient asks for a full refund.
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /^Request a refund/ }).first().click();
  await page.locator("textarea").fill("The doctor did not come.");
  await page.getByRole("button", { name: "Send request" }).click();

  const refund = await waitFor(async () => (await db.doc(`refundRequests/${consultationId}`).get()).data(), {
    timeout: 30000,
    what: "the refund request",
  });
  expect(refund.outcome).toBe("doctor_unavailable");
  expect(refund.suggestedRefund).toBe(150);
  expect(bookingId).toBeTruthy();
});
