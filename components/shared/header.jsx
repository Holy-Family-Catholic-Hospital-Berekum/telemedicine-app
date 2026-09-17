import { Link, useLocation } from "react-router-dom";
import logo from "../../src/assets/logo.png";
import { HOSPITAL_PHONE_DISPLAY, HOSPITAL_PHONE_TEL } from "./contact";

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
  isLoggedIn = false,
}) {
  const isMinimal = variant === "minimal";
  const { pathname } = useLocation();
  const isHome = pathname === "/";
  const isDashboard = pathname === "/dashboard";
  const isBooking = pathname === "/book";

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
        <header className="sticky top-0 z-30 border-b border-[#14213814] bg-white/95 backdrop-blur-xl">
          <div className="mx-auto max-w-5xl px-5 sm:px-8 h-[72px] sm:h-20 flex items-center justify-between gap-3">
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

            <nav className="flex items-center gap-2 sm:gap-3 shrink-0">
              {isLoggedIn && (
                <Link
                  to="/dashboard"
                  className={`rounded-full px-3.5 py-2 text-[13px] sm:text-[14px] font-semibold transition ${
                    isDashboard
                      ? "bg-[#E7F4EF] text-[var(--teal)]"
                      : "text-[var(--ink)] hover:bg-[#F2F7F5] hover:text-[var(--teal)]"
                  }`}
                >
                  Dashboard
                </Link>
              )}

              <Link
                to={cancelHref}
                className="rounded-full px-3.5 py-2 text-[13px] sm:text-[14px] font-medium text-[#14213899] hover:bg-[#F7F8F8] hover:text-[var(--ink)] transition-colors"
              >
                {cancelLabel}
              </Link>
            </nav>
          </div>
        </header>
      </>
    );
  }

  return (
    <>
      {sharedStyle}

      <header className="fixed top-0 inset-x-0 z-40">
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

          {isLoggedIn ? (
            <Link to="/dashboard" className="hover:text-white">
              Dashboard
            </Link>
          ) : (
            <>
              <Link to="/signin" className="hover:text-white">
                Sign in
              </Link>
              <span className="text-white/25">|</span>
              <Link to="/signup" className="hover:text-white">
                Sign up
              </Link>
            </>
          )}
        </div>

        <div className="bg-white/95 backdrop-blur-xl border-b border-[#14213814] shadow-[0_8px_30px_-24px_rgba(20,33,56,0.35)]">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 h-16 sm:h-20 flex items-center justify-between gap-3">
            <Link
              to="/"
              className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0"
            >
              <img
                src={logo}
                alt="Holy Family Catholic Hospital, Berekum"
                className="h-9 w-9 sm:h-12 sm:w-12 rounded-full shrink-0"
              />
              <span className="leading-tight min-w-0">
                <span className="block font-display font-medium truncate text-[17px]">
                  Holy Family Catholic Hospital
                </span>
                <span className="hidden sm:block text-[13px] text-[#14213899]">
                  Berekum, Ghana
                </span>
              </span>
            </Link>

            <nav className="flex items-center gap-1 sm:gap-2 shrink-0">
              <Link
                to="/"
                className={`hidden sm:inline-flex rounded-full px-3.5 py-2 text-[14px] font-medium transition ${
                  isHome
                    ? "bg-[#F3F7F6] text-[var(--teal)]"
                    : "text-[var(--ink)] hover:bg-[#F7F8F8] hover:text-[var(--teal)]"
                }`}
              >
                Home
              </Link>

              {isLoggedIn && (
                <Link
                  to="/dashboard"
                  className={`hidden sm:inline-flex rounded-full px-3.5 py-2 text-[14px] font-semibold transition ${
                    isDashboard
                      ? "bg-[#E7F4EF] text-[var(--teal)]"
                      : "text-[var(--ink)] hover:bg-[#F3F7F6] hover:text-[var(--teal)]"
                  }`}
                >
                  Dashboard
                </Link>
              )}

              <a
                href={HOSPITAL_PHONE_TEL}
                className="hidden lg:inline-flex items-center gap-2 rounded-full border border-[#14213822] px-4 py-2 text-[14px] font-medium text-[var(--ink)]
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

              {!isLoggedIn && (
                <>
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
                </>
              )}

              <Link
                to="/book"
                className={`hidden sm:inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-[14px] font-semibold transition
                  ${
                    isBooking
                      ? "bg-[var(--teal)] text-white shadow-[0_8px_20px_-8px_rgba(31,122,108,0.55)]"
                      : "bg-[var(--brand-orange)] text-white shadow-[0_8px_20px_-6px_rgba(248,133,53,0.55)] hover:brightness-95 active:brightness-90"
                  }
                  focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-orange)]`}
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
