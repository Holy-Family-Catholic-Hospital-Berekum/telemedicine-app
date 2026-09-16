// Centralized hospital contact info, so the phone number only needs
// updating in one place (Header's call line and the homepage's
// "call the hospital" quick action both import from here).
//
// PLACEHOLDER — replace both values with the hospital's real line
// before shipping. Keep the tel: value in +233 international format
// so tap-to-call works correctly on every phone regardless of locale.
export const HOSPITAL_PHONE_DISPLAY = "024 000 0000";
export const HOSPITAL_PHONE_TEL = "tel:+233240000000";
