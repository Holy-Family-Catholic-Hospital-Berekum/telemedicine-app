// Centralized hospital contact info, so the phone number only needs
// updating in one place (Header's call line and the homepage's
// "call the hospital" quick action both import from here).
//
// PLACEHOLDER — replace both values with the hospital's real line
// before shipping. Keep the tel: value in +233 international format
// so tap-to-call works correctly on every phone regardless of locale.
export const HOSPITAL_PHONE_DISPLAY = "024 000 0000";
export const HOSPITAL_PHONE_TEL = "tel:+233240000000";

// WhatsApp number for patient support (the floating "Chat with us" button
// on patient pages). Digits only, international format without "+":
// Ghana 024 000 0000 -> "233240000000". PLACEHOLDER: replace with the
// support line's real WhatsApp number before launch.
export const SUPPORT_WHATSAPP = "233240000000";
