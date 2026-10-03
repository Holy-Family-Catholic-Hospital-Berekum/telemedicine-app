// functions/lib/consentText.js
//
// The exact wording a patient agrees to when booking. The server stores the
// version and a SHA-256 of this text on every consent record, so the wording
// that was agreed to can be proved later.
//
// MUST stay identical to src/consentText.js (the copy the browser shows).
// To change the wording: add a new version here and there, never edit a
// published one. The client sends the version it displayed; the server
// refuses anything but CURRENT_BOOKING_CONSENT, so a stale page asks the
// patient to reload instead of recording consent to text they never saw.

const BOOKING_CONSENT_TEXT = {
  "2026-10-v1":
    "To set up and carry out this consultation we collect your date of " +
    "birth, sex, location and phone number. Only hospital administrators " +
    "and the doctor assigned to you can see them, and they are permanently " +
    "deleted when your consultation is closed. We keep a short record of " +
    "each consultation (doctor, date, start and end time, and the amount " +
    "paid) so you and the hospital can see your history. Online video " +
    "consultations may be recorded (video and audio) when the hospital has " +
    "call recording switched on; a REC sign shows on screen whenever a call " +
    "is being recorded. Recordings are stored securely, can only be opened " +
    "by authorised hospital administrators, and every access is logged. " +
    "Payment is handled by Paystack; we never see or store your mobile " +
    "money PIN.",
};

const CURRENT_BOOKING_CONSENT = "2026-10-v1";

module.exports = { BOOKING_CONSENT_TEXT, CURRENT_BOOKING_CONSENT };
