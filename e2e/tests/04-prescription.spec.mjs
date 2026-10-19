// Prescriptions: the doctor writes one during the video call, the patient
// downloads the PDF from the dashboard, a pharmacist checks the QR code,
// the doctor cancels it, and after 7 days it's deleted with only an audit
// line left. The doctor is the robot (real server functions, helpers.mjs);
// the patient uses the website.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test, expect } from "@playwright/test";
import {
  createPatient,
  createPaidBooking,
  scheduleWithDoctor,
  signInOnSite,
  callAs,
  db,
  Timestamp,
  waitFor,
  logBrowser,
} from "../helpers.mjs";

const require = createRequire(import.meta.url);

// A real 1x1 PNG, standing in for the drawn signature.
const SIGNATURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const MEDICINE = {
  medicine: "Amoxicillin",
  strength: "500 mg",
  form: "capsule",
  dose: "1 capsule",
  frequency: "Three times a day",
  duration: "7 days",
  quantity: "21",
};

test("prescription: written in the call, downloaded, checked, cancelled, deleted", async ({ page }) => {
  test.setTimeout(6 * 60 * 1000);
  logBrowser(page);
  const patient = await createPatient("Kofi Asante");
  const bookingId = await createPaidBooking(patient);
  const { consultationId, doctor, device } = await scheduleWithDoctor(bookingId, 2 * 60 * 1000);

  // Before the call: nothing to prescribe for yet.
  await expect(
    callAs(doctor, "issuePrescription", { consultationId, items: [MEDICINE] }),
  ).rejects.toThrow(/MDC registration number/);

  // The doctor's Account tab: MDC number and signature (the robot's
  // sign-in is minutes old, so it counts as a fresh sign-in).
  await callAs(doctor, "updatePrescriberDetails", { mdcNumber: "mdc/rn/4521", signature: SIGNATURE });
  const profile = (await db.doc(`adminUsers/${doctor.uid}`).get()).data();
  expect(profile.mdcNumber).toBe("MDC/RN/4521");

  // Not connected yet: refused.
  await expect(
    callAs(doctor, "issuePrescription", { consultationId, items: [MEDICINE] }),
  ).rejects.toThrow(/once you and the patient have been connected/);

  // The call: the doctor is in the room, the patient joins on the website.
  await callAs(doctor, "startVideoCall", { consultationId, roomDevice: device });
  const keepDoctorThere = setInterval(
    () => callAs(doctor, "callHeartbeat", { consultationId, connected: true }).catch(() => {}),
    5000,
  );
  let prescriptionId;
  try {
    await signInOnSite(page, patient);
    await page.getByRole("button", { name: "Join call" }).click({ timeout: 60000 });
    await page.getByRole("button", { name: "Everything works: join" }).click({ timeout: 30000 });
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button").last().click();

    // Both in the room and connected: the consultation has taken place.
    await waitFor(
      async () => (await db.doc(`consultations/${consultationId}`).get()).data()?.metAt,
      { timeout: 90000, what: "the two to be connected" },
    );

    // During the call, the doctor writes the prescription.
    ({ prescriptionId } = await callAs(doctor, "issuePrescription", {
      consultationId,
      items: [MEDICINE],
      notes: "Take after meals.",
    }));
    expect(prescriptionId).toMatch(/^RX-/);
    // Only one per consultation.
    await expect(
      callAs(doctor, "issuePrescription", { consultationId, items: [MEDICINE] }),
    ).rejects.toThrow(/already has a prescription/);
  } finally {
    clearInterval(keepDoctorThere);
  }

  const rx = (await db.doc(`prescriptions/${prescriptionId}`).get()).data();
  expect(rx.patientUid).toBe(patient.uid);
  expect(rx.patientAge).toBe("34 years");
  expect(rx.patientSex).toBe("male");
  expect(rx.doctorMdcNumber).toBe("MDC/RN/4521");
  expect((await db.doc(`prescriptionSignatures/${prescriptionId}`).get()).exists).toBe(true);

  // The patient downloads it from the dashboard.
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Your prescriptions" })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText("Amoxicillin 500 mg capsule")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    page.getByRole("button", { name: "Download PDF" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`Prescription-${prescriptionId}.pdf`);
  const pdf = readFileSync(await download.path());
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

  // A pharmacist scans the QR code: valid, the doctor and the medicines,
  // never the patient's name.
  await page.goto(`/check-prescription#${rx.checkCode}`);
  await expect(page.getByRole("heading", { name: "Valid prescription" })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText("MDC/RN/4521")).toBeVisible();
  await expect(page.getByText("Amoxicillin 500 mg capsule", { exact: false })).toBeVisible();
  await expect(page.getByText("Kofi Asante")).toHaveCount(0);

  // The doctor cancels it: the check page and the patient see it.
  await callAs(doctor, "cancelPrescription", { prescriptionId, reason: "Wrong dose." });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Cancelled by the doctor" })).toBeVisible({ timeout: 60000 });
  await expect(callAs(patient, "getPrescriptionPdf", { prescriptionId })).rejects.toThrow(/cancelled/);
  await page.goto("/dashboard");
  await expect(page.getByText(/Your doctor cancelled this prescription/)).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole("button", { name: "Download PDF" })).toHaveCount(0);

  // 7 days later the hourly clean-up deletes it; only an audit line stays.
  await db.doc(`prescriptions/${prescriptionId}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  const { deleteExpired } = require("../../functions/prescriptions.js");
  expect(await deleteExpired()).toBeGreaterThanOrEqual(1);
  expect((await db.doc(`prescriptions/${prescriptionId}`).get()).exists).toBe(false);
  expect((await db.doc(`prescriptionSignatures/${prescriptionId}`).get()).exists).toBe(false);
  const audit = await db.collection("auditLog").where("targetId", "==", prescriptionId).get();
  const codes = audit.docs.map((d) => d.data().code).sort();
  expect(codes).toEqual([
    "prescription.cancelled",
    "prescription.deleted",
    "prescription.downloaded",
    "prescription.issued",
  ]);
  expect(JSON.stringify(audit.docs.map((d) => d.data()))).not.toContain("Amoxicillin");
  await page.goto(`/check-prescription#${rx.checkCode}`);
  await expect(page.getByRole("heading", { name: "No valid prescription with this code" })).toBeVisible({
    timeout: 60000,
  });
});
