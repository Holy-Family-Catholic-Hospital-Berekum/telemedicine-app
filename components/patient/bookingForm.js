// The booking page's details form (bookConsultation.jsx): what it checks
// before going on, and what it sends to createBookingDraft. The server
// re-checks all of it.

import { CURRENT_BOOKING_CONSENT, CURRENT_GUARDIAN_CONSENT } from "../../src/consentText.js";

/** "+233241234567" -> "0241234567"; other numbers as stored; none -> "". */
export function localPhone(e164) {
  if (typeof e164 !== "string") return "";
  const m = e164.match(/^\+233(\d{9})$/);
  return m ? `0${m[1]}` : e164;
}

/** Whole years typed in the age box, or null if it isn't 0-120. */
export function parseYears(value) {
  const t = String(value).trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n <= 120 ? n : null;
}

/** Months are asked as well for a child under 2 (doctors need it for babies). */
export function needsAgeMonths(years) {
  return years !== null && years < 2;
}

/**
 * The first problem with the details step, as the message to show, or null.
 * What we ask for depends on the mode (medical director): a video call
 * needs age, sex and location; a hospital visit needs none of that. Every
 * booking needs a phone number and the consent.
 */
export function detailsError(form) {
  const { type, mode, forChild, childName, ageYears, ageMonths, sex, town, area, phone } = form;
  const online = mode === "online";
  const parsedYears = parseYears(ageYears);
  const needsMonths = needsAgeMonths(parsedYears);
  if (!type || !mode) {
    return "Choose a consultation type and a mode to continue.";
  }
  if (forChild && childName.trim().length < 2) {
    return "Enter your child's full name to continue.";
  }
  if (online && parsedYears === null) {
    return forChild
      ? "Enter your child's age in years to continue."
      : "Enter your age in years to continue.";
  }
  if (online && needsMonths && ageMonths === "") {
    return "For a child under 2, also choose their age in months.";
  }
  const age = online ? parsedYears : null;
  if (online && !forChild && age < 18) {
    return "You must be 18 or older to book for yourself. If this consultation is for your child, choose \"My child (under 18)\" above.";
  }
  if (online && forChild && age >= 18) {
    return "This age is 18 or over. Adults need to book from their own account.";
  }
  if (online && !sex) {
    return "Select your sex to continue.";
  }
  if (online && !town.trim()) {
    return "Enter your town or city to continue.";
  }
  if (online && !area.trim()) {
    return "Enter your area, or a place near you, to continue.";
  }
  if (phone.replace(/\D/g, "").length < 9) {
    return "Enter a phone number we can call you on.";
  }
  if (!form.consent) {
    return "Please confirm you agree to how we use your information before continuing.";
  }
  if (forChild && !form.guardianConsent) {
    return "Please confirm you are the child's parent or guardian and give consent for them.";
  }
  return null;
}

/** What createBookingDraft receives. */
export function bookingPayload(form) {
  const { type, mode, forChild, childName, ageYears, ageMonths, sex, town, area, phone } = form;
  const parsedYears = parseYears(ageYears);
  return {
    type,
    mode,
    ...(mode === "online"
      ? {
          ageYears: parsedYears,
          ...(needsAgeMonths(parsedYears) ? { ageMonths: Number(ageMonths) } : {}),
          sex,
          town: town.trim(),
          area: area.trim(),
        }
      : {}),
    phone: phone.trim(),
    doctorUid: form.doctorUid || null,
    slotId: form.slotId || null,
    consentVersion: CURRENT_BOOKING_CONSENT,
    ...(forChild
      ? {
          forChild: true,
          childName: childName.trim(),
          guardianConsentVersion: CURRENT_GUARDIAN_CONSENT,
        }
      : {}),
  };
}
