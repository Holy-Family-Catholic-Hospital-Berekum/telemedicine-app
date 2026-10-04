// src/consentText.js
//
// The booking consent wording shown to patients. MUST stay identical to
// functions/lib/consentText.js: the server stores a hash of its own copy,
// keyed by the version the page sends. Never edit a published version; add
// a new one and bump CURRENT_BOOKING_CONSENT in both files.

export const CURRENT_BOOKING_CONSENT = "2026-10-v2";

export const BOOKING_CONSENT_TEXT =
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
    "money PIN.";

// Shown once, the first time a patient joins each video consultation.
// MUST match CALL_CONSENT_TEXT[CURRENT_CALL_CONSENT] in functions/lib/consentText.js.
export const CURRENT_CALL_CONSENT = "2026-10-call-v1";

export const CALL_CONSENT_TEXT =
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
  "by video on these terms.";
