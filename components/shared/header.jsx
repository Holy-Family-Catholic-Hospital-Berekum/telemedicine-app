import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import logo from "../../src/assets/logo.png";
import { auth } from "../../src/firebase";
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

const backArrowPath = (
  <path
    d="M12.5 5L7 10l5.5 5"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);

const signOutIconPath = (
  <>
    <path
      d="M8 4.5H4.8A1.3 1.3 0 0 0 3.5 5.8v8.4a1.3 1.3 0 0 0 1.3 1.3H8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12.7 13.3 16.5 10l-3.8-3.3M16.5 10H8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </>
);

const menuIconPath = (
  <path
    d="M4 6.5h12M4 10h12M4 13.5h12"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
  />
);

const closeIconPath = (
  <path
    d="M5 5l10 10M15 5 5 15"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
  />
);

// Hoisted out of Header so it isn't redefined (and therefore remounted by
// React, losing any internal state/focus) on every Header render — e.g.
// every time mobileMenuOpen toggles.
function SignOutButton({ onSignOut, className = "" }) {
  return (
    <button
      type="button"
      onClick={onSignOut}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border border-[#14213822]
                  px-3.5 py-2 text-[15px] sm:text-[16px] font-medium text-[#142138b8]
                  hover:border-[#c0392b55] hover:text-[#c0392b]
                  transition-colors focus-visible:outline focus-visible:outline-2
                  focus-visible:outline-offset-2 focus-visible:outline-[var(--ink)]
                  ${className}`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
      >
        {signOutIconPath}
      </svg>
      Sign out
    </button>
  );
}

export default function Header({
  variant = "full",
  cancelHref = "/",
  cancelLabel = "Cancel",
}) {
  const isMinimal = variant === "minimal";
  const { pathname } = useLocation();

  const isHome = pathname === "/";
  const isDashboard = pathname === "/dashboard";
  const isBooking = pathname === "/book";

  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(pathname);

  // Close the mobile menu when the route changes. Adjusting state during
  // render (instead of in an effect) avoids an extra render pass.
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMobileMenuOpen(false);
  }

  /* ...auth effect stays as is... */

  /*
   * Read the real Firebase authentication state. The header updates
   * automatically when the user signs in or signs out anywhere in the
   * application.
   */
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
    return unsubscribe;
  }, []);

  const isLoggedIn = authReady && !!user;

  async function handleSignOut() {
    try {
      await signOut(auth);
      setMobileMenuOpen(false);
    } catch (error) {
      console.error("Sign out failed:", error);
    }
  }

  const sharedStyle = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap');

      :root {
        --brand-orange: #F88535;
        --ink: #142138;
        --teal: #1F7A6C;
        --tint: #FFF4EA;
      }

      .font-display {
        font-family: 'Fraunces', serif;
      }

      .font-body {
        font-family: 'Inter', sans-serif;
      }
    `}</style>
  );

  /*
   * ------------------------------------------------------------------------
   * MINIMAL HEADER
   *
   * Used by the booking page.
   *
   * IMPORTANT:
   * `sticky top-0` works because the booking page now renders this header
   * INSIDE its scrollable content container.
   * ------------------------------------------------------------------------
   */
  if (isMinimal) {
    return (
      <>
        {sharedStyle}

        <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-xl border-b border-[#14213814] shadow-[0_10px_30px_-26px_rgba(20,33,56,0.4)]">
          <div
            aria-hidden="true"
            className="h-[3px] w-full bg-gradient-to-r from-[var(--teal)] via-[var(--brand-orange)] to-[var(--teal)]"
          />

          <div className="mx-auto max-w-5xl px-4 sm:px-8 min-h-[68px] sm:min-h-[76px] flex items-center justify-between gap-3">
            <Link to="/" className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <img
                src={logo}
                alt="Holy Family Catholic Hospital, Berekum"
                className="h-9 w-9 sm:h-11 sm:w-11 rounded-full shrink-0 ring-2 ring-[var(--tint)]"
              />

              <span className="min-w-0 leading-tight">
                <span className="block font-display font-medium truncate text-[16px] sm:text-[17px]">
                  Holy Family Catholic Hospital
                </span>

                <span className="hidden sm:block text-[14px] text-[#142138a0]">
                  Telemedicine · Berekum, Ghana
                </span>
              </span>
            </Link>

            {/* Desktop minimal actions */}
            <nav className="hidden sm:flex items-center gap-2 sm:gap-3 shrink-0">
              {isLoggedIn ? (
                <>
                  <Link
                    to="/dashboard"
                    className={`rounded-full px-3.5 py-2 text-[15px] sm:text-[16px] font-semibold transition ${
                      isDashboard
                        ? "bg-[#E7F4EF] text-[var(--teal)]"
                        : "text-[var(--ink)] hover:bg-[#F2F7F5] hover:text-[var(--teal)]"
                    }`}
                  >
                    Dashboard
                  </Link>

                  <SignOutButton onSignOut={handleSignOut} />
                </>
              ) : (
                <>
                  <Link
                    to="/signin"
                    className="rounded-full px-3.5 py-2 text-[15px] sm:text-[16px] font-medium text-[var(--ink)]
                               hover:text-[var(--brand-orange)] transition-colors"
                  >
                    Sign in
                  </Link>

                  <Link
                    to="/signup"
                    className="rounded-full border border-[#14213822] px-3.5 py-2 text-[15px] sm:text-[16px]
                               font-medium text-[var(--ink)] hover:border-[var(--teal)]
                               hover:text-[var(--teal)] transition-colors"
                  >
                    Sign up
                  </Link>
                </>
              )}

              <Link
                to={cancelHref}
                className="inline-flex items-center gap-1 rounded-full px-3.5 py-2 text-[15px] sm:text-[16px]
                           font-medium text-[#14213899] hover:bg-[#F7F8F8]
                           hover:text-[var(--ink)] transition-colors"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                >
                  {backArrowPath}
                </svg>

                {cancelLabel}
              </Link>
            </nav>

            {/* Mobile minimal actions */}
            <div className="sm:hidden flex items-center gap-2">
              {isLoggedIn && (
                <Link
                  to="/dashboard"
                  className="rounded-full bg-[#E7F4EF] px-3 py-2 text-[14px] font-semibold text-[var(--teal)]"
                >
                  Dashboard
                </Link>
              )}

              <button
                type="button"
                onClick={() => setMobileMenuOpen((value) => !value)}
                aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
                aria-expanded={mobileMenuOpen}
                className="h-9 w-9 rounded-full border border-[#14213822] flex items-center justify-center
                           text-[var(--ink)] hover:border-[var(--teal)] hover:text-[var(--teal)] transition"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                >
                  {mobileMenuOpen ? closeIconPath : menuIconPath}
                </svg>
              </button>
            </div>
          </div>

          {/* Mobile dropdown */}
          {mobileMenuOpen && (
            <div className="sm:hidden border-t border-[#14213810] bg-white px-4 py-3">
              <div className="flex flex-col gap-1">
                {isLoggedIn ? (
                  <>
                    <Link
                      to="/dashboard"
                      className="rounded-xl px-4 py-3 text-[16px] font-medium text-[var(--ink)]
                                 hover:bg-[#F3F7F6] hover:text-[var(--teal)]"
                    >
                      Dashboard
                    </Link>

                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="text-left rounded-xl px-4 py-3 text-[16px] font-medium text-[#c0392b]
                                 hover:bg-[#c0392b0d]"
                    >
                      Sign out
                    </button>
                  </>
                ) : (
                  <>
                    <Link
                      to="/signin"
                      className="rounded-xl px-4 py-3 text-[16px] font-medium text-[var(--ink)]
                                 hover:bg-[#F3F7F6]"
                    >
                      Sign in
                    </Link>

                    <Link
                      to="/signup"
                      className="rounded-xl px-4 py-3 text-[16px] font-medium text-[var(--ink)]
                                 hover:bg-[#F3F7F6]"
                    >
                      Sign up
                    </Link>
                  </>
                )}

                <Link
                  to={cancelHref}
                  className="rounded-xl px-4 py-3 text-[16px] font-medium text-[#14213899]
                             hover:bg-[#F7F8F8] hover:text-[var(--ink)]"
                >
                  ← {cancelLabel}
                </Link>
              </div>
            </div>
          )}
        </header>
      </>
    );
  }

  /*
   * ------------------------------------------------------------------------
   * FULL PUBLIC HEADER
   * ------------------------------------------------------------------------
   */

  return (
    <>
      {sharedStyle}

      <header className="fixed top-0 inset-x-0 z-40">
        {/* Mobile utility strip */}
        <div className="sm:hidden flex min-h-8 items-center justify-between gap-2 bg-[#F48732] px-4 text-[14px] text-white/90">
          <a
            href={HOSPITAL_PHONE_TEL}
            className="inline-flex items-center gap-1 min-w-0"
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
            <span className="truncate">{HOSPITAL_PHONE_DISPLAY}</span>
          </a>

          <div className="flex items-center gap-2 shrink-0">
            {isLoggedIn ? (
              <>
                <Link
                  to="/dashboard"
                  className="hover:text-white whitespace-nowrap"
                >
                  Dashboard
                </Link>
                <span className="text-white/25">|</span>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="hover:text-white whitespace-nowrap"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/signin"
                  className="hover:text-white whitespace-nowrap"
                >
                  Sign in
                </Link>
                <span className="text-white/25">|</span>
                <Link
                  to="/signup"
                  className="hover:text-white whitespace-nowrap"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>

        <div className="bg-white/95 backdrop-blur-xl border-b border-[#14213814] shadow-[0_8px_30px_-24px_rgba(20,33,56,0.35)]">
          <div className="mx-auto max-w-7xl px-4 sm:px-8 min-h-16 sm:h-20 flex items-center justify-between gap-3">
            {/* Logo */}
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
                <span className="block font-display font-medium truncate text-[16px] sm:text-[17px]">
                  Holy Family Catholic Hospital
                </span>
                <span className="hidden sm:block text-[15px] text-[#14213899]">
                  Berekum, Ghana
                </span>
              </span>
            </Link>

            {/* Desktop navigation */}
            <nav className="hidden md:flex items-center gap-1.5 lg:gap-2 shrink-0">
              <Link
                to="/"
                className={`rounded-full px-3.5 py-2 text-[16px] font-medium transition ${
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
                  className={`rounded-full px-3.5 py-2 text-[16px] font-semibold transition ${
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
                className="hidden lg:inline-flex items-center gap-2 rounded-full border border-[#14213822]
                           px-4 py-2 text-[16px] font-medium text-[var(--ink)]
                           hover:border-[var(--teal)] hover:text-[var(--teal)] transition-colors"
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
                    className="px-2 text-[16px] font-medium text-[var(--ink)]
                               hover:text-[var(--brand-orange)] transition-colors"
                  >
                    Sign in
                  </Link>

                  <Link
                    to="/signup"
                    className="rounded-full border border-[#14213822] px-4 py-2 text-[16px]
                               font-medium text-[var(--ink)] hover:border-[var(--teal)]
                               hover:text-[var(--teal)] transition-colors"
                  >
                    Sign up
                  </Link>
                </>
              )}

              {isLoggedIn && <SignOutButton onSignOut={handleSignOut} />}

              <Link
                to="/book"
                className={`inline-flex items-center gap-1.5 rounded-full px-5 py-2.5
                            text-[16px] font-semibold transition ${
                              isBooking
                                ? "bg-[var(--teal)] text-white shadow-[0_8px_20px_-8px_rgba(31,122,108,0.55)]"
                                : "bg-[var(--brand-orange)] text-white shadow-[0_8px_20px_-6px_rgba(248,133,53,0.55)] hover:brightness-95 active:brightness-90"
                            }`}
              >
                Get Care Now
              </Link>
            </nav>

            {/* Mobile menu button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((value) => !value)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
              className="md:hidden h-10 w-10 rounded-full border border-[#14213822]
                         flex items-center justify-center shrink-0 text-[var(--ink)]
                         hover:border-[var(--teal)] hover:text-[var(--teal)] transition"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
              >
                {mobileMenuOpen ? closeIconPath : menuIconPath}
              </svg>
            </button>
          </div>

          {/* Mobile navigation */}
          {mobileMenuOpen && (
            <div className="md:hidden border-t border-[#14213810] bg-white px-4 py-3">
              <nav className="flex flex-col gap-1">
                <Link
                  to="/"
                  className={`rounded-xl px-4 py-3 text-[16px] font-medium ${
                    isHome
                      ? "bg-[#F3F7F6] text-[var(--teal)]"
                      : "text-[var(--ink)] hover:bg-[#F7F8F8]"
                  }`}
                >
                  Home
                </Link>

                {isLoggedIn && (
                  <Link
                    to="/dashboard"
                    className={`rounded-xl px-4 py-3 text-[16px] font-semibold ${
                      isDashboard
                        ? "bg-[#E7F4EF] text-[var(--teal)]"
                        : "text-[var(--ink)] hover:bg-[#F7F8F8]"
                    }`}
                  >
                    Dashboard
                  </Link>
                )}

                <Link
                  to="/book"
                  className="rounded-xl bg-[var(--brand-orange)] px-4 py-3 text-[16px]
                             font-semibold text-white"
                >
                  Get Care Now
                </Link>

                <a
                  href={HOSPITAL_PHONE_TEL}
                  className="rounded-xl px-4 py-3 text-[16px] font-medium text-[var(--ink)]
                             hover:bg-[#F7F8F8]"
                >
                  Call the hospital
                </a>

                {!isLoggedIn ? (
                  <>
                    <Link
                      to="/signin"
                      className="rounded-xl px-4 py-3 text-[16px] font-medium text-[var(--ink)]
                                 hover:bg-[#F7F8F8]"
                    >
                      Sign in
                    </Link>
                    <Link
                      to="/signup"
                      className="rounded-xl px-4 py-3 text-[16px] font-medium text-[var(--ink)]
                                 hover:bg-[#F7F8F8]"
                    >
                      Sign up
                    </Link>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="text-left rounded-xl px-4 py-3 text-[16px] font-medium text-[#c0392b]
                               hover:bg-[#c0392b0d]"
                  >
                    Sign out
                  </button>
                )}
              </nav>
            </div>
          )}
        </div>
      </header>
    </>
  );
}
