import { useState } from "react";
import { Lock, ChevronDown } from "lucide-react";

/** Whole years from a YYYY-MM-DD date of birth (older bookings). */
function yearsFromDob(dobString) {
  const dob = new Date(dobString);
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  const notYetHadBirthday =
    now.getMonth() < dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (notYetHadBirthday) years -= 1;
  return years;
}

/** "34 years", "1 year 4 months", "7 months". */
function describeAge({ age, dateOfBirth }) {
  if (age && Number.isInteger(age.years)) {
    const y = age.years;
    const m = Number.isInteger(age.months) ? age.months : null;
    const yText = `${y} ${y === 1 ? "year" : "years"}`;
    const mText = m !== null ? `${m} ${m === 1 ? "month" : "months"}` : "";
    if (y === 0 && mText) return mText;
    return mText ? `${yText} ${mText}` : yText;
  }
  // Bookings made before age replaced the date of birth.
  if (dateOfBirth) return `${yearsFromDob(dateOfBirth)} years`;
  return null;
}

// Visibility is enforced by Firestore Security Rules (only the assigned
// doctor and admins can read the consultation). These details are deleted
// when the consultation is closed.
export default function SensitiveDetails({ details }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-[#DCE6EC]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-2.5 text-left text-xs text-[#5C6B72] transition hover:text-[#12242C]"
      >
        <span className="flex items-center gap-1.5">
          <Lock size={12} strokeWidth={2} />
          Clinical details
        </span>
        <ChevronDown
          size={14}
          strokeWidth={2}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-4 px-5 pb-4 text-sm">
          <div>
            <p className="text-xs text-[#5C6B72]">Age</p>
            <p className="text-[#12242C]">{describeAge(details) || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-[#5C6B72]">Sex</p>
            <p className="text-[#12242C] capitalize">{details.sex || "—"}</p>
          </div>
        </div>
      )}
    </div>
  );
}
