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
