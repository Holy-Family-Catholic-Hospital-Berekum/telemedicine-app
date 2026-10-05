import { useState } from "react";
import { Lock, ChevronDown } from "lucide-react";

function age(dobString) {
  const dob = new Date(dobString);
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  const notYetHadBirthday =
    now.getMonth() < dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (notYetHadBirthday) years -= 1;
  return years;
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
            <p className="text-xs text-[#5C6B72]">Date of birth</p>
            <p className="text-[#12242C]">
              {details.dateOfBirth ? (
                <>
                  {new Date(`${details.dateOfBirth}T00:00:00Z`).toLocaleDateString(undefined, {
                    timeZone: "UTC",
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}{" "}
                  <span className="text-[#5C6B72]">
                    ({age(details.dateOfBirth)} yrs)
                  </span>
                </>
              ) : (
                "—"
              )}
            </p>
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
