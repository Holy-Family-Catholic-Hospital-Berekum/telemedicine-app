import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { TYPE_LABELS } from "../../src/constants";

// Public doctor profile pieces for the home page: the summary shown on each
// card and the full-profile dialog. Everything here comes from the public
// doctorProfiles document (src/doctorDirectory.js); doctors fill it in from
// the doctor portal, and anything they haven't filled in is simply left out.

function experienceLabel(years) {
  const n = Number(years);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${n} ${n === 1 ? "year" : "years"} of experience`;
}

function Chips({ items, max }) {
  if (!items?.length) return null;
  const shown = max ? items.slice(0, max) : items;
  const extra = items.length - shown.length;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {shown.map((s) => (
        <li
          key={s}
          className="rounded-full bg-[var(--forest)]/[0.07] px-2.5 py-1 text-[11.5px] font-medium text-[var(--forest-2)]"
        >
          {s}
        </li>
      ))}
      {extra > 0 && (
        <li className="rounded-full px-2 py-1 text-[11.5px] text-[#142138a6]">+{extra} more</li>
      )}
    </ul>
  );
}

/** Compact facts under the name on a doctor card. */
export function DoctorCardSummary({ doctor }) {
  const facts = [doctor.title, experienceLabel(doctor.yearsExperience)].filter(Boolean);
  const types = doctor.availableFor.map((t) => TYPE_LABELS[t] ?? t);
  return (
    <>
      {facts.length > 0 && (
        <p className="mt-1 text-[12.5px] text-[#142138b3]">{facts.join(" · ")}</p>
      )}
      {types.length > 0 && (
        <p className="mt-1.5 text-[12px] text-[#142138a6]">Sees patients for: {types.join(", ")}</p>
      )}
      <Chips items={doctor.specialties} max={3} />
      {(doctor.bio || doctor.focus) && (
        <p className="mt-2.5 line-clamp-3 text-[13.5px] leading-relaxed text-[#142138b3]">
          {doctor.bio || doctor.focus}
        </p>
      )}
      {doctor.languages.length > 0 && (
        <p className="mt-2 text-[12px] text-[#142138a6]">Speaks {doctor.languages.join(", ")}</p>
      )}
    </>
  );
}

/** Full profile in a modal dialog. */
export function DoctorProfileDialog({ doctor, canBook, onClose, Portrait, BookingGlyph }) {
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const facts = [doctor.title, experienceLabel(doctor.yearsExperience)].filter(Boolean);
  const types = doctor.availableFor.map((t) => TYPE_LABELS[t] ?? t);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="doctor-profile-name"
        className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="grid w-full gap-5 sm:grid-cols-[180px_1fr]">
            <div className="mx-auto w-40 sm:w-full">
              <Portrait doctor={doctor} />
            </div>
            <div>
              <h3
                id="doctor-profile-name"
                className="font-display text-[22px] font-medium leading-tight text-[var(--ink2)]"
              >
                {doctor.name}
              </h3>
              {doctor.role && (
                <p className="mt-1 text-[14px] font-medium text-[var(--forest-2)]">{doctor.role}</p>
              )}
              {facts.length > 0 && (
                <p className="mt-1 text-[13.5px] text-[#142138b3]">{facts.join(" · ")}</p>
              )}
              <p className="mt-2 text-[13px] text-[#142138a6]">{doctor.availability}</p>

              {types.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#142138a6]">
                    Consultations
                  </h4>
                  <p className="mt-1 text-[14px] text-[var(--ink2)]">{types.join(", ")}</p>
                </div>
              )}
              {doctor.specialties.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#142138a6]">
                    Specialties
                  </h4>
                  <Chips items={doctor.specialties} />
                </div>
              )}
              {doctor.languages.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#142138a6]">
                    Languages
                  </h4>
                  <p className="mt-1 text-[14px] text-[var(--ink2)]">{doctor.languages.join(", ")}</p>
                </div>
              )}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className="shrink-0 rounded-full p-2 text-[#142138a6] hover:bg-black/5 hover:text-[var(--ink2)]"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {(doctor.bio || doctor.focus) && (
          <div className="mt-6">
            <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#142138a6]">About</h4>
            {doctor.focus && doctor.bio && (
              <p className="mt-1 text-[14px] font-medium text-[var(--ink2)]">{doctor.focus}</p>
            )}
            <p className="mt-1.5 whitespace-pre-line text-[14.5px] leading-relaxed text-[#142138cc]">
              {doctor.bio || doctor.focus}
            </p>
          </div>
        )}

        {canBook && (
          <Link
            to={`/book?doctor=${doctor.id}`}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#F88535] px-5 py-2.5 text-[14px] font-medium text-white transition hover:brightness-95"
          >
            <BookingGlyph className="shrink-0" />
            Book this doctor
          </Link>
        )}
      </div>
    </div>
  );
}
