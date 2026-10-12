// A patient signs up, confirms their email, books a video call and pays.
// The payment window is the robot's stand-in for Paystack (helpers.mjs);
// everything else is the real website and real server code on the emulator.
import { test, expect } from "@playwright/test";
import { uniqueEmail, PASSWORD, verifyEmail, stubPaystack, db, waitFor, logBrowser } from "../helpers.mjs";

test("sign up, confirm email, book a video call and pay", async ({ page }) => {
  const email = uniqueEmail("patient");
  logBrowser(page);
  await stubPaystack(page);

  // Sign up
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Ama Mensah");
  await page.getByLabel("Phone number").fill("0241234567");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "Create account" }).click();
  // The emulator starts each function cold on first use: allow time.
  await expect(page).toHaveURL(/verify-email/, { timeout: 60000 });

  // The robot "clicks the link in the email"; the page notices by itself.
  const uid = await verifyEmail(email);
  await expect(page).not.toHaveURL(/verify-email/, { timeout: 30000 });

  // Book: video call for myself, details, consent, pay
  await page.goto("/book");
  await page.getByRole("button", { name: /General OPD/i }).first().click();
  await page.getByRole("button", { name: /video call/i }).first().click();
  await page.getByRole("radio", { name: "Myself" }).click();
  await page.locator("#ageYears").fill("34");
  await page.locator("#sex").selectOption("female");
  await page.locator("#town").fill("Berekum");
  await page.locator("#area").fill("Senase");
  await page.locator("#phone").fill("0241234567");
  for (const box of await page.getByRole("checkbox").all()) if (!(await box.isChecked())) await box.check();
  await page.getByRole("button", { name: "Next: pay" }).click();

  // Payment step: the robot's stand-in Paystack window "pays" at once.
  await page.getByText("Pay for your consultation").waitFor();
  await page.getByRole("button", { name: /^Pay GHS \d+ with mobile money$/ }).click();

  // The server checks with "Paystack" and confirms the booking.
  const booking = await waitFor(
    async () => {
      const snap = await db.collection("bookings").where("patientUid", "==", uid).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() })).find((b) => b.status === "paid");
    },
    { timeout: 120000, what: "the booking to be paid" },
  );
  expect(booking.mode).toBe("online");
  expect(booking.age).toEqual({ years: 34, months: null });
  expect((await db.doc(`confirmedPayments/${booking.paystackReference}`).get()).exists).toBe(true);

  // The patient sees it waiting for a doctor and a time.
  await page.goto("/dashboard");
  await expect(page.getByText(/waiting to be scheduled/i).first()).toBeVisible();
});
