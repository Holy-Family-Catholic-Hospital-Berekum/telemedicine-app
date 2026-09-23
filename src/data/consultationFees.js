// Fallback consultation-fee matrix. Live, admin-editable prices come from
// useSiteSettings() for the "general" tier — keep the numbers below in step
// with DEFAULT_FEES in functions/siteSettings.js.
//
// A specialist doctor costs more than a general doctor for the same
// consultation type. That markup isn't wired to Firestore/siteSettings yet
// (no doctorProfiles.fee field, no admin UI for it), so it lives here as its
// own small table for now — swap for a real per-doctor fee once that exists.
export const CONSULTATION_FEES = {
  OPD: { general: 250, specialist: 350 },
  SURGICAL: { general: 300, specialist: 450 },
};

// The specialist - general delta for a type, added on top of whatever the
// live "general" price for that type turns out to be (see bookConsultation.jsx).
export function specialistSurcharge(type) {
  const table = CONSULTATION_FEES[type];
  if (!table) return 0;
  return table.specialist - table.general;
}

// Used only before useSiteSettings() has resolved, or if a type is missing
// from it entirely.
export function getFallbackFee(type, tier = "general") {
  return CONSULTATION_FEES[type]?.[tier] ?? CONSULTATION_FEES[type]?.general ?? 0;
}
