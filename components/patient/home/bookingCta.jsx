import { Link } from "react-router-dom";

// Small calendar-with-checkmark glyph shared by every "Book a consultation"
// entry point, so the action is recognisable by silhouette alone.
export function BookingGlyph({ className = "" }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M6 3v2M14 3v2M4 7.5h12M5 5h10a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z M7.7 11.2l1.5 1.5L13 9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Every "Book a consultation" entry point, in two weights:
 *
 *   variant="gold"   — hero, CTA banner and anywhere inline. Warm gold pill.
 *   variant="aurora" — the floating mobile bar. A thin multi-colour light
 *                      rotates around the pill edge; the white face stays
 *                      readable, only the 2px rim moves.
 */
export default function BookingCta({
  to = "/book",
  children = "Book Consultation",
  size = "md",
  variant = "gold",
  className = "",
}) {
  const sizing =
    size === "lg"
      ? "pl-7 pr-7 py-4 text-[16px] gap-3"
      : "pl-6 pr-6 py-3.5 text-[16px] gap-2.5";

  const base = `group relative inline-flex items-center justify-center ${sizing} rounded-full font-semibold
                transition active:scale-[0.97]
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`;

  if (variant === "aurora") {
    return (
      // p-[2px] leaves exactly the rim the rotating light shows through.
      <span
        className={`relative isolate inline-flex rounded-full p-[2px] overflow-hidden ${className}`}
      >
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 -z-10 aspect-square w-[240%] -translate-x-1/2 -translate-y-1/2
                     motion-safe:[animation:auroraSpin_6s_linear_infinite]"
          style={{
            background:
              "conic-gradient(from 0deg, #F8C15C, #6EE7B7, #7DD3FC, #C4B5FD, #FDA4AF, #F8C15C)",
          }}
        />
        <Link
          to={to}
          className={`${base} w-full bg-white text-[var(--forest,#1F3D33)]
                      hover:bg-[#FDFBF5]
                      focus-visible:outline-[#7DD3FC]`}
        >
          <BookingGlyph className="shrink-0" />
          <span>{children}</span>
        </Link>
      </span>
    );
  }

  return (
    <Link
      to={to}
      className={`${base}
                  bg-gradient-to-r from-[var(--gold)] via-[#E8935A] to-[var(--brand-orange,#F88535)]
                  text-[var(--ink2)]
                  shadow-[0_16px_34px_-10px_rgba(199,122,60,0.55)]
                  hover:brightness-105 hover:shadow-[0_20px_42px_-10px_rgba(199,122,60,0.65)]
                  focus-visible:outline-[var(--gold)] ${className}`}
    >
      <BookingGlyph className="shrink-0" />
      <span>{children}</span>
    </Link>
  );
}
