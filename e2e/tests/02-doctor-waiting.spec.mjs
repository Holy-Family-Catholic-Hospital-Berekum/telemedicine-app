// The doctor is in the room first: the patient's dashboard says so, and the
// patient joins (camera check with the fake camera, video consent, call
// screen). Staff steps go through the real server functions (helpers.mjs).
import { test, expect } from "@playwright/test";
import {
  createPatient,
  createPaidBooking,
  scheduleWithDoctor,
  signInOnSite,
  callAs,
  db,
  waitFor,
  logBrowser,
} from "../helpers.mjs";

test("doctor waiting: the patient is told and joins the call", async ({ page }) => {
  logBrowser(page);
  const patient = await createPatient("Kofi Asante");
  const bookingId = await createPaidBooking(patient);
  // Starts in 2 minutes: the room is open (it opens 30 minutes before).
  const { consultationId, doctor, device } = await scheduleWithDoctor(bookingId, 2 * 60 * 1000);

  // The doctor enters the room from the registered room computer and stays.
  await callAs(doctor, "startVideoCall", { consultationId, roomDevice: device });
  const keepDoctorThere = setInterval(() => callAs(doctor, "callHeartbeat", { consultationId }).catch(() => {}), 15000);

  try {
    await signInOnSite(page, patient);
    await expect(page.getByText(/Your doctor is in the call\. Join before/)).toBeVisible({ timeout: 60000 });

    await page.getByRole("button", { name: "Join call" }).click();
    await page.getByRole("button", { name: "Everything works: join" }).click({ timeout: 30000 });
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button").last().click();

    // The server sees the patient in the room, with the doctor.
    const c = await waitFor(
      async () => {
        const d = (await db.doc(`consultations/${consultationId}`).get()).data();
        return d?.presence?.patient && d?.presence?.doctor ? d : null;
      },
      { timeout: 60000, what: "both to be in the room" },
    );
    expect(c.patientFirstJoinedAt).toBeTruthy();
    // Nobody is waiting on anybody any more.
    expect(c.waitDeadline).toBeUndefined();
    // Consent was recorded for this consultation.
    const consents = await db.collection("consents").where("consultationId", "==", consultationId).get();
    expect(consents.docs.map((d) => d.data().subjectUid)).toEqual([patient.uid]);
  } finally {
    clearInterval(keepDoctorThere);
  }
});
