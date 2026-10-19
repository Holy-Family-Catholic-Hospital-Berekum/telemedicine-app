// Downloading a prescription form (PDF), for the patient it was written
// for and the doctor who wrote it. The server builds the form with the
// doctor's signature (functions/prescriptions.js getPrescriptionPdf), so
// the signature image never reaches the browser on its own.

import { httpsCallable } from "firebase/functions";
import { functions } from "../../src/firebase";
import { tracked } from "../../src/networkStatus";

const callGetPrescriptionPdf = tracked(httpsCallable(functions, "getPrescriptionPdf"));

// Keep in step with VALID_DAYS in functions/lib/prescriptions.js.
export const PRESCRIPTION_VALID_DAYS = 7;

/** Fetches the PDF and saves it ("Prescription-RX-….pdf"). */
export async function downloadPrescription(prescriptionId) {
  const { data } = await callGetPrescriptionPdf({ prescriptionId });
  const bytes = Uint8Array.from(atob(data.pdf), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = data.fileName || `Prescription-${prescriptionId}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** "Amoxicillin 500 mg capsule" */
export function medicineLabel(item) {
  return [item.medicine, item.strength, item.form].filter(Boolean).join(" ");
}
