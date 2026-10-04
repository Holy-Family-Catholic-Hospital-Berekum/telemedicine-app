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
  "2026-10-v2":
    "To set up and carry out this consultation we collect your date of " +
    "birth, sex, location and phone number. Only hospital administrators " +
    "and the doctor assigned to you can see them, and they are " +
    "permanently deleted when your consultation is closed. We keep a " +
    "short record of each consultation (doctor, date, start and end time, " +
    "and the amount paid) so you and the hospital can see your history. " +
    "Online video consultations may be recorded, either as video with " +
    "sound or as sound only, when the hospital has call recording " +
    "switched on; a REC sign shows on screen whenever a call is being " +
    "recorded. Recordings are stored securely, can only be opened by " +
    "authorised hospital administrators, and every access is logged. " +
    "Payment is handled by Paystack; we never see or store your mobile " +
    "money PIN.",
};

const CURRENT_BOOKING_CONSENT = "2026-10-v2";

// Shown once, the first time a patient joins each video consultation.
const CALL_CONSENT_TEXT = {
  "2026-10-call-v1":
  "This video consultation is a private conversation between you and " +
  "your doctor at Holy Family Catholic Hospital. Video and sound travel " +
  "encrypted between your device and the doctor's. When the hospital " +
  "has call recording switched on, the call is recorded (video with " +
  "sound, or sound only) and a REC sign shows on screen; recordings are " +
  "stored securely, only authorised hospital administrators can open " +
  "them, and every access is logged. Please join from a private, quiet " +
  "place, do not record or share the call yourself, and tell the doctor " +
  "if you would rather be seen in person. A video consultation has " +
  "limits: the doctor may ask you to come to the hospital if they " +
  "cannot assess you properly by video. By joining you agree to be seen " +
  "by video on these terms.",
};

const CURRENT_CALL_CONSENT = "2026-10-call-v1";

module.exports = {
  BOOKING_CONSENT_TEXT,
  CURRENT_BOOKING_CONSENT,
  CALL_CONSENT_TEXT,
  CURRENT_CALL_CONSENT,
};
