import { Link, useLocation } from "react-router-dom";
import logo from "../../src/assets/logo.png";
import { HOSPITAL_PHONE_DISPLAY, HOSPITAL_PHONE_TEL } from "./contact";

/**
 * Header.jsx (components/shared)
 * Reusable site header with two variants:
 *   - "full" (default): logo, a single "Home" link (highlighted when
 *     active), a call number, sign in / sign up, and a "Book a
 *     consultation" CTA. Used on the public landing page.
 *   - "minimal": logo plus a single link back out (e.g. "Cancel" -> "/").
 *     Used on focused task flows like the booking form. Unchanged.
 *
 * The "full" header is `position: fixed`, so any page that renders it
 * needs top padding to clear it — Home.jsx adds `pt-24 sm:pt-20` on its
 * first child for exactly this. If you add this header to another page,
 * do the same there.
 *
 * On mobile, the header splits into two thin rows rather than cramming
 * items into one: a slim utility row (call, sign in, sign up) sits above
 * the main row (logo, Home). The Book button itself is hidden below `sm` —
 * Home.jsx renders its own persistent "Book a consultation" bar fixed to
 * the bottom of the screen on mobile, which is the more reachable spot
 * for a thumb than the top of the screen, so the header doesn't need to
 * duplicate it there. From `sm` up there's room for everything in a
 * single row, Book included, and the utility row disappears into it.
 *
 * `/signin` and `/signup` are assumed route paths — update the two
 * `Link to=` values below if your routes are named differently.
 *
 * This component also injects the app's shared fonts (Fraunces + Inter) and
 * CSS custom properties (--brand-orange, --ink, --teal, --tint) via a global
 * <style> tag, since Header is expected to render on every page. Any page or
 * component using those variables (e.g. Footer) assumes Header is present
 * somewhere on the page. If you'd rather not couple it this way, move the
 * <style> block into your global index.css instead and delete it here.
 *
 * Expects the hospital logo at src/assets/logo.png, adjust the import path
 * if your assets folder lives elsewhere.
 */

const phoneIconPath = (
  <path
    d="M4.5 3.5h2.7c.5 0 .9.3 1 .8l.7 2.6c.1.4 0 .9-.3 1.2L7.3 9.4c1 2.1 2.7 3.8 4.8 4.8l1.3-1.3c.3-.3.8-.4 1.2-.3l2.6.7c.5.1.8.5.8 1v2.7c0 .6-.5 1-1 1-6.9 0-12.5-5.6-12.5-12.5 0-.5.4-1 1-1z"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);

export default function Header({
  variant = "full",
  cancelHref = "/",
  cancelLabel = "Cancel",
}) {
  const isMinimal = variant === "minimal";
  const { pathname } = useLocation();
  const isHome = pathname === "/";

  const sharedStyle = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap');
      :root {
        --brand-orange: #F88535;
        --ink: #142138;
        --teal: #1F7A6C;
        --tint: #FFF4EA;
      }
      .font-display { font-family: 'Fraunces', serif; }
      .font-body { font-family: 'Inter', sans-serif; }
    `}</style>
  );

  if (isMinimal) {
    return (
      <>
        {sharedStyle}
        <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-[#14213814]">
          <div className="mx-auto max-w-3xl px-5 sm:px-8 h-[72px] sm:h-20 flex items-center justify-between gap-3">
            <Link to="/" className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <img
                src={logo}
                alt="Holy Family Catholic Hospital, Berekum"
                className="h-9 w-9 sm:h-11 sm:w-11 rounded-full shrink-0"
              />
              <span className="block font-display font-medium truncate text-[14px] sm:text-[16px]">
                Holy Family Catholic Hospital
              </span>
            </Link>
            <Link
              to={cancelHref}
              className="text-[13px] sm:text-[14px] text-[#14213899] hover:text-[var(--ink)] transition-colors shrink-0"
            >
              {cancelLabel}
            </Link>
          </div>
        </header>
      </>
    );
  }

  return (
    <>
      {sharedStyle}

      <header className="fixed top-0 inset-x-0 z-40">
        {/* Mobile-only utility row: secondary actions, kept out of the way
            of the primary row so Book stays the obvious action. */}
        <div className="sm:hidden flex h-8 items-center justify-end gap-3 bg-[#F48732] px-5 text-[11px] text-white/90">
          <a
            href={HOSPITAL_PHONE_TEL}
            className="inline-flex items-center gap-1"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              {phoneIconPath}
            </svg>
            {HOSPITAL_PHONE_DISPLAY}
          </a>
          <span className="text-white/25">|</span>
          <Link to="/signin" className="hover:text-white">
            Sign in
          </Link>
          <span className="text-white/25">|</span>
          <Link to="/signup" className="hover:text-white">
            Sign up
          </Link>
        </div>

        <div className="bg-white/95 backdrop-blur border-b border-[#14213814]">
          <div className="mx-auto max-w-6xl px-5 sm:px-8 h-16 sm:h-20 flex items-center justify-between gap-2 sm:gap-3">
            <Link
              to="/"
              className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0"
            >
              <img
                src={logo}
                alt="Holy Family Catholic Hospital, Berekum"
                className="h-9 w-9 sm:h-12 sm:w-12 rounded-full shrink-0"
              />
              <span className=" leading-tight min-w-0">
                <span className="block font-display font-medium truncate text-[17px]">
                  Holy Family Catholic Hospital
                </span>
                <span className="block text-[13px] text-[#14213899]">
                  Berekum, Ghana
                </span>
              </span>
            </Link>

            <nav className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
              {/* From sm up, the utility-row items live here instead. */}
              <a
                href={HOSPITAL_PHONE_TEL}
                className="hidden sm:inline-flex items-center gap-2 rounded-full border border-[#14213822] px-4 py-2 text-[14px] font-medium text-[var(--ink)]
                           hover:border-[var(--teal)] hover:text-[var(--teal)] transition-colors
                           focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink)]"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                >
                  {phoneIconPath}
                </svg>
                {HOSPITAL_PHONE_DISPLAY}
              </a>

              <Link
                to="/signin"
                className="hidden sm:inline-block px-2 text-[14px] font-medium text-[var(--ink)] hover:text-[var(--brand-orange)] transition-colors"
              >
                Sign in
              </Link>

              <Link
                to="/signup"
                className="hidden sm:inline-block rounded-full border border-[#14213822] px-4 py-2 text-[14px] font-medium text-[var(--ink)]
                           hover:border-[var(--teal)] hover:text-[var(--teal)] transition-colors"
              >
                Sign up
              </Link>

              <Link
                to="/book"
                className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-orange)] text-white text-[15px] font-semibold px-6 py-3
                           shadow-[0_8px_20px_-6px_rgba(248,133,53,0.55)]
                           hover:brightness-95 active:brightness-90 transition
                           focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]"
              >
                Book a consultation
              </Link>
            </nav>
          </div>
        </div>
      </header>
    </>
  );
}
