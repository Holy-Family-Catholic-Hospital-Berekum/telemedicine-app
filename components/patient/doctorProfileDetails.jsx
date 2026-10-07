import { TYPE_LABELS } from "../../src/constants";

// What a doctor card on the home page shows. Ghana's rules on advertising
// doctors (hospital decision, medical director): only the doctor's name
// (on the card), specialty and what they see patients for. No bio, qualifications or years of experience, and no full-profile
// page. Comes from the public doctorProfiles document (src/doctorDirectory.js).

function Row({ label, children }) {
  return (
    <p className="mt-1.5 text-[15px] text-[#142138cc]">
      <span className="font-medium text-[var(--ink2)]">{label}:</span> {children}
    </p>
  );
}

/** Specialty and what they see patients for. */
export function DoctorCardSummary({ doctor }) {
  const specialty = doctor.specialties.length ? doctor.specialties.join(", ") : doctor.role;
  const types = doctor.availableFor.map((t) => TYPE_LABELS[t] ?? t);
  return (
    <>
      {specialty && <Row label="Specialty">{specialty}</Row>}
      {types.length > 0 && <Row label="Sees patients for">{types.join(", ")}</Row>}
    </>
  );
}
