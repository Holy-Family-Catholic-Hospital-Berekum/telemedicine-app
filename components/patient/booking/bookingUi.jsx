// Small pieces shared by the booking page's steps.
import { useState } from "react";

// Back arrow between steps. Only step 1 renders this — step 0 has
// nothing behind it (the header's "Back to home" covers leaving), and
// step 2 is a completed state.
export function BackButton({ onClick, children = "Back" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 mb-6 text-[16px] font-medium text-black/75
                 hover:text-[#0095D9] transition-colors
                 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0095D9] rounded"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M12.5 5L7 10l5.5 5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </button>
  );
}

/**
 * The error banner. Rendered *next to the control that failed*, not at
 * the top of the page — that was the whole problem. It takes the ref so
 * the page can scroll it into view and focus it (see the effect in
 * BookConsultation).
 */
export function ErrorMessage({ error, innerRef }) {
  if (!error) return null;
  return (
    <div
      ref={innerRef}
      role="alert"
      aria-live="assertive"
      tabIndex={-1}
      className="mb-5 flex items-start gap-3 rounded-xl bg-[#F88535]/10 border border-[#F88535]/40 text-[#A85420] text-[16px] px-4 py-3
                 scroll-mt-24 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F88535]"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className="mt-0.5 shrink-0"
      >
        <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M10 6v5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <circle cx="10" cy="14" r="1" fill="currentColor" />
      </svg>
      <span>{error.message}</span>
    </div>
  );
}

// Small spinner for in-flight payment states.
export function Spinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="motion-safe:animate-spin"
    >
      <circle
        cx="10"
        cy="10"
        r="7.5"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="2"
      />
      <path
        d="M17.5 10A7.5 7.5 0 0 0 10 2.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Small round doctor portrait used in the "current selection" summary and
// in each row of the picker. Falls back to initials, same idea as
// DoctorPortrait on the home page, just circular and smaller.
export function DoctorAvatar({ doctor, size = 44 }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(doctor.image) && !failed;

  return (
    <div
      className="shrink-0 overflow-hidden rounded-full bg-[#0095D9] flex items-center justify-center text-white font-medium"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {showImage ? (
        <img
          src={doctor.image}
          alt=""
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        doctor.initials
      )}
    </div>
  );
}
