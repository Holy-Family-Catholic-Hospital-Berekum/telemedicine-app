import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Header from "../shared/header";
import Footer from "../shared/footer";
import { HOSPITAL_PHONE_TEL } from "../shared/contact";
import landingImage from "../../src/assets/landingImage.webp";
import { useAuth } from "../../src/context/authContext.jsx";
import HealthcarePreloader from "../../src/components/common/healthcarePreloader.jsx";
import EmergencyNotice from "./emergencyNotice";
import heroDefault from "../../src/assets/hero-consult.webp";
import { useSiteSettings } from "../../src/siteSettings";
import { usePageMeta } from "../../src/seo.js";
import BookingCta from "./home/bookingCta";
import DoctorsSlider from "./home/doctorsSlider";
import HeroSection from "./home/heroSection";
import OpenSlots from "./home/openSlots";
/**
 * Home.jsx
 * Public landing page for Holy Family Catholic Hospital's telemedicine platform.
 * Lives at the "/" route. Its larger sections are in ./home/ (hero, doctors
 * slider, open appointment times, the booking button).
 *
 * Design concept: a hospital appointment slip rather than a generic "video
 * call a doctor" product. The slip (BookingSlip) appears, unfilled, for
 * each consultation type, and "closed" in the privacy section to represent
 * the booking details being erased after a visit.
 *
 * DOCTOR SELECTION: each doctor card in "Our doctors" carries a
 * "Book this doctor" link to `/book?doctor=<id>` (when the admin allows
 * choosing a doctor). bookConsultation.jsx reads that query param on
 * arrival and pre-selects the doctor there (its own doctor picker stays
 * closed in that case, since there's nothing left to choose) — see the
 * doctor-selection notes at the top of that file.
 *
 * CTA system (home/bookingCta.jsx):
 * - Hero: the warm gold pill, with a shimmer sweep.
 * - Floating mobile bar: the page's one loud moment. A thin rotating
 *   multi-colour light runs around the pill, with a few tiny bright crystals
 *   twinkling in the bar behind it, so the action stays noticeable after the
 *   hero has scrolled away.
 * - Services and CTA banner: the gold pill.
 *
 * Images:
 * - Hero photo: siteSettings.heroImage (admin-editable), falling back to
 *   src/assets/hero-consult.webp.
 * - Doctor portraits come from each doctor's profile photo (doctor portal).
 *   Missing photos degrade to an initials tile, they don't break.
 *
 * Auth: the default export (Home, at the bottom of this file) waits for
 * Firebase to resolve the session, showing the custom preloader meanwhile,
 * then renders HomeContent with a real `isLoggedIn` flag. The gate lives in
 * a wrapper on purpose: HomeContent's hooks (useStampOnce in particular)
 * attach to DOM nodes on mount, so the page content must not mount until
 * auth has resolved, or those hooks would run against an empty page.
 *
 * Palette is scoped locally to <main> via CSS custom properties so it
 * doesn't touch the --ink / --teal / --brand-orange / --tint variables
 * Header/Footer already rely on globally. Icons are hand-drawn inline SVG.
 */

// The two ways to be seen. The hospital's services are listed separately
// (admin-managed, "Our services" below).
const consultTypes = [
  {
    type: "OPD",
    title: "General OPD",
    detail:
      "Everyday health concerns, check-ups, and follow-up visits with our outpatient doctors.",
    mode: "By video call or at the hospital",
  },
  {
    type: "SURGICAL",
    title: "Surgical consultation",
    detail:
      "Before or after an operation, with our surgical team.",
    mode: "By video call or at the hospital",
  },
];

const steps = [
  {
    title: "Create your account",
    detail:
      "Sign up with your name, phone number and email. We send you an email: open it and tap the link to confirm it's you.",
  },
  {
        title: "Book a consultation",
    detail:
      "Choose the care you need, choose a video call or a visit to the hospital, then pay with mobile money (MoMo).",
  },
  {
        title: "We give you a time",
    detail:
      "The hospital chooses a doctor and a time for you, and sends them to your email.",
  },
  {
        title: "See your doctor",
    detail:
      "For a video call, open your dashboard at your time and tap Join call. For a hospital visit, come to the hospital at your time.",
  },
];

const quickActions = [
  {
    label: "Book General OPD",
    href: "/book?type=OPD",
    icon: (
      <path
        d="M10 3v3.2M6.4 4.6 8 7.2M13.6 4.6 12 7.2M5 10c0-2.8 2.2-5 5-5s5 2.2 5 5c0 3.9-2.2 7-5 7s-5-3.1-5-7Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    label: "Book Surgical",
    href: "/book?type=SURGICAL",
    icon: (
      <path
        d="M5 5h7l3 3v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z M12 5v3h3 M7.5 11.5h5 M10 9v5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    label: "Call the hospital",
    href: HOSPITAL_PHONE_TEL,
    icon: (
      <path
        d="M4.5 3.5h2.7c.5 0 .9.3 1 .8l.7 2.6c.1.4 0 .9-.3 1.2L7.3 9.4c1 2.1 2.7 3.8 4.8 4.8l1.3-1.3c.3-.3.8-.4 1.2-.3l2.6.7c.5.1.8.5.8 1v2.7c0 .6-.5 1-1 1-6.9 0-12.5-5.6-12.5-12.5 0-.5.4-1 1-1z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
];

// Tiny crystals scattered behind the floating mobile CTA. Each is a small
// rotated diamond that twinkles on its own offset, so the bar reads as
// "lit" without any one dot being loud enough to distract.
const crystals = [
  { left: "6%", top: "22%", size: 5, color: "#F8C15C", delay: 0 },
  { left: "17%", top: "70%", size: 3, color: "#7DD3FC", delay: 620 },
  { left: "31%", top: "16%", size: 4, color: "#C4B5FD", delay: 1180 },
  { left: "45%", top: "78%", size: 3, color: "#FDA4AF", delay: 1740 },
  { left: "58%", top: "20%", size: 5, color: "#6EE7B7", delay: 900 },
  { left: "71%", top: "68%", size: 3, color: "#F8C15C", delay: 1420 },
  { left: "84%", top: "26%", size: 4, color: "#7DD3FC", delay: 320 },
  { left: "93%", top: "72%", size: 3, color: "#C4B5FD", delay: 2000 },
];

// Small check glyph used on the sub-service pills under each consultation
// type, so each item reads as "included" at a glance rather than a plain
// bullet.
function CheckGlyph({ className = "" }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="8" cy="8" r="7.5" fill="var(--forest)" opacity="0.12" />
      <path
        d="M5 8.2l2 2 4-4.4"
        stroke="var(--forest)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// The recurring visual device: a booking slip, one for each consultation
// type; `voided` renders a stamped overlay for the privacy section,
// representing erasure after a visit.
function BookingSlip({ type, mode, voided = false, className = "" }) {
  return (
    <div
      className={`relative w-full max-w-[300px] rounded-2xl bg-[var(--parchment)] text-[var(--ink2)] ${className}`}
      style={{ boxShadow: "0 30px 60px -24px rgba(15,20,17,0.5)" }}
    >
      <div className="px-6 pt-6 pb-5">
        <p className="text-[14px] text-[var(--forest-2)]">
          Holy Family Catholic Hospital
        </p>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 mt-3">
          {/* The mode badge drops under the title when the card is too
              narrow for both on one line (phones). */}
          <span className="min-w-0 font-display font-medium leading-tight text-[19px] sm:text-[20px]">
            {type}
          </span>
          <span className="max-w-full rounded-full bg-[var(--forest)] px-3 py-1 text-[14px] font-medium text-[var(--parchment)]">
            {mode}
          </span>
        </div>
        <div className="border-t border-dashed border-[#16211b30] mt-5 pt-4">
          {/* An empty line, like the blank reference box on a paper slip. */}
          <p className="mt-1 font-mono text-[16px] text-[#16211b70]" />
        </div>
      </div>
      {voided && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-6 flex items-center justify-center"
        >
          <span
            className="rotate-[-8deg] rounded-md border-[3px] border-[var(--gold)] px-4 py-1.5 text-[16px] font-medium tracking-wide text-[var(--gold)] opacity-0"
            style={{ animation: "var(--stamp-anim, none)" }}
            data-stamp
          >
            Details erased
          </span>
        </div>
      )}
    </div>
  );
}

// Triggers a stamp reveal once the privacy section scrolls into view.
// Respects reduced motion by showing the stamp already in place — the
// preference is read in the useState initialiser, so no effect has to set
// state synchronously.
function useStampOnce() {
  const ref = useRef(null);
  const [ready, setReady] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    if (ready) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setReady(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ready]);

  return { ref, ready };
}

/** The hospital's services; the list is edited in the admin Control panel. */
function ServicesSection({ services }) {
  if (!services?.length) return null;
  return (
    <section id="services" className="pb-16 sm:pb-24">
      <div className="mx-auto max-w-5xl px-5 sm:px-8">
        <h2 className="font-display text-[26px] sm:text-[30px] font-medium text-[var(--ink2)]">
          Our services
        </h2>
        <p className="mt-3 max-w-lg text-[16px] text-[#142138cc]">
          Book a consultation and tell us what you need. The hospital will
          match you with the right doctor.
        </p>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((name) => (
            <li
              key={name}
              className="flex items-center gap-3 rounded-2xl border border-[var(--forest)]/15 bg-[var(--forest)]/[0.04] px-4 py-3.5 text-[16px] font-medium text-[var(--ink2)]"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-[var(--forest-2)] shadow-sm">
                <CheckGlyph />
              </span>
              {name}
            </li>
          ))}
        </ul>
        <div className="mt-8">
          <BookingCta />
        </div>
      </div>
    </section>
  );
}

// The page itself. Only mounted once auth has resolved (see Home below), so
// useStampOnce's ref is attached to a real DOM node on its first effect run.
function HomeContent({ isLoggedIn }) {
  const { ref: privacyRef, ready: stampReady } = useStampOnce();
  const { settings } = useSiteSettings();
  const heroImage = settings.heroImage ?? heroDefault;

  return (
    <div className="font-body text-[#142138] bg-white overflow-x-hidden">
      <Header variant="full" isLoggedIn={isLoggedIn} />
      <EmergencyNotice />

      <main
        id="top"
        className="pt-24 sm:pt-20"
        style={{
          "--forest": "#1F3D33",
          "--forest-2": "#2F5D4C",
          "--gold": "#C79A3C",
          "--parchment": "#F7F1E1",
          "--ink2": "#16211B",
          "--brand-blue": "#0095D9",
          "--brand-blue-deep": "#00699C",
          "--brand-orange": "#F48732",
        }}
      >
        <style>{`
          @keyframes stampIn {
            from { opacity: 0; transform: rotate(-8deg) scale(1.4); }
            to { opacity: 1; transform: rotate(-8deg) scale(1); }
          }

          @keyframes auroraSpin {
            to { transform: translate(-50%, -50%) rotate(360deg); }
          }
          @keyframes crystalTwinkle {
            0%, 100% { opacity: .15; transform: rotate(45deg) scale(0.6); }
            50% { opacity: 1; transform: rotate(45deg) scale(1); }
          }
          [data-stamp] { animation: none; }
          .stamp-ready [data-stamp] {
            animation: stampIn 0.6s cubic-bezier(0.2,0.9,0.3,1) both;
          }
        `}</style>

        {/* ---------- Hero ---------- */}
        <HeroSection heroImage={heroImage} />

        {/* ---------- How it works ---------- */}
        <section
          id="how-it-works"
          className="py-16 sm:py-24 bg-[var(--parchment)]"
        >
          <div className="mx-auto max-w-3xl px-5 sm:px-8">
            <h2 className="font-display text-[26px] sm:text-[30px] font-medium text-[var(--ink2)]">
              How you get care
            </h2>

            <ol className="mt-10 sm:mt-14 relative border-l-2 border-dashed border-[var(--forest)]/25 pl-6 sm:pl-8 space-y-9 sm:space-y-10">
              {steps.map((item, i) => (
                <li key={item.title} className="relative">
                  <span className="absolute -left-[31px] sm:-left-[39px] top-0 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--forest)] text-[14px] font-medium text-[var(--parchment)]">
                    {i + 1}
                  </span>
                  <h3 className="font-medium text-[16px] sm:text-[16px] text-[var(--ink2)]">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-[16px] sm:text-[16px] leading-relaxed text-[#16211bb3]">
                    {item.detail}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------- Consultation types ---------- */}
        <section id="care" className="py-16 sm:py-24">
          <div className="mx-auto max-w-5xl px-5 sm:px-8">
            <h2 className="font-display text-[26px] sm:text-[30px] font-medium max-w-lg text-[var(--ink2)]">
              Which care do you need?
            </h2>
            <p className="mt-3 text-[16px] sm:text-[16px] text-[#142138cc] max-w-lg">
              You can see the doctor by video call on your phone, or come
                to the hospital. Choose what works for you.
            </p>

            <div className="mt-10 sm:mt-14 grid sm:grid-cols-2 gap-8 sm:gap-10">
              {consultTypes.map((service) => (
                <div key={service.title}>
                  <Link
                    to={`/book?type=${service.type}`}
                    className="group block rounded-2xl transition
                               focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--forest)]"
                  >
                    <div className="transition duration-300 group-hover:-translate-y-1.5">
                      <BookingSlip
                        type={service.title}
                        mode={service.mode}
                        className="max-w-none mx-auto sm:mx-0 transition duration-300 group-hover:shadow-[0_36px_70px_-24px_rgba(15,20,17,0.55)]"
                      />
                    </div>
                    <p className="mt-4 text-[16px] leading-relaxed text-[#142138b3] text-center sm:text-left max-w-sm mx-auto sm:mx-0">
                      {service.detail}
                    </p>
                    <span className="mt-2 inline-flex items-center gap-1.5 text-[15px] font-medium text-[var(--forest-2)] transition group-hover:text-[var(--forest)]">
                      Book this consultation
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 20 20"
                        fill="none"
                        aria-hidden="true"
                        className="transition group-hover:translate-x-0.5"
                      >
                        <path
                          d="M7 5l6 5-6 5"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  </Link>
                </div>
              ))}
            </div>

            <div className="mt-10 flex items-center gap-4 sm:gap-6">
              <div className="hidden sm:block h-24 w-32 shrink-0 overflow-hidden rounded-2xl">
                <img
                  src={landingImage}
                  alt="A doctor consulting with a patient over video call"
                  className="h-full w-full object-cover"
                />
              </div>
              <p className="text-[16px] sm:text-[16px] leading-relaxed text-[#142138b3] max-w-md">
                Whichever you choose, the same doctors who see you at the
                hospital are the ones who hold your consultation.
              </p>
            </div>
          </div>
        </section>

        {/* ---------- Our services (admin-managed) ---------- */}
        <ServicesSection services={settings.services} />

        {/* ---------- Our doctors ---------- */}
        <section id="doctors" className="pb-16 sm:pb-24">
          <div className="mx-auto max-w-6xl px-3 sm:px-5">
            <div className="px-2 sm:px-3">
              <h2 className="font-display text-[26px] sm:text-[30px] font-medium text-[var(--ink2)]">
                Our doctors
              </h2>
              <p className="mt-3 max-w-lg text-[16px] sm:text-[16px] text-[#142138cc]">
                After you book, the hospital chooses one of these doctors for
                you, based on what you need.
              </p>
            </div>

            <DoctorsSlider />
          </div>
        </section>

        {/* ---------- Open appointment times ---------- */}
        <OpenSlots />

        {/* ---------- CTA banner ---------- */}
        <section className="px-5 sm:px-8 py-16 sm:py-24">
          <div className="mx-auto max-w-6xl rounded-3xl bg-[#0095D9] text-[var(--parchment)] px-6 sm:px-10 py-10 sm:py-14 flex flex-col md:flex-row md:items-center gap-8 md:gap-10">
            <div className="flex-1 text-center md:text-left">
              <h2 className="font-display text-[24px] sm:text-[28px] font-medium">
                Ready when you are
              </h2>
              <p className="mt-3 text-[16px] leading-relaxed text-[var(--parchment)]/70 max-w-sm mx-auto md:mx-0">
                Book a consultation now, or call the hospital directly if you'd
                rather speak to someone first.
              </p>
              <div className="mt-6 flex justify-center md:justify-start">
                <BookingCta />
              </div>
            </div>

            <div className="flex-1 flex flex-wrap justify-center md:justify-end gap-2.5">
              {quickActions.map((action) => (
                <a
                  key={action.label}
                  href={action.href}
                  className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-[var(--parchment)]/20 px-4 py-2.5 text-[15px] font-medium text-[var(--parchment)]/90
                             hover:border-[var(--gold)] hover:text-[var(--gold)] transition"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                  >
                    {action.icon}
                  </svg>
                  {action.label}
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Privacy ---------- */}
        <section
          id="privacy"
          ref={privacyRef}
          className={`relative overflow-hidden bg-gradient-to-r from-[#C79A3C] via-[#E8935A] to-[#F88535] py-16 sm:py-24 ${
            stampReady ? "stamp-ready" : ""
          }`}
        >
          <div className="relative mx-auto max-w-6xl px-5 sm:px-8 grid md:grid-cols-[1.1fr_0.9fr] gap-10 items-center">
            <div className="max-w-xl text-center md:text-left">
              <h2 className="font-display text-[24px] sm:text-[28px] font-medium text-[var(--parchment)]">
                How we look after your information
              </h2>
              <p className="mt-4 text-[16px] sm:text-[16px] leading-relaxed text-[var(--parchment)]/75">
                After your consultation, we delete the details you gave when
                booking (age, sex, where you live and phone). We
                only keep a short note of the visit: the doctor, the date and
                what you paid. Video calls may be recorded by the hospital.
                You will see a red REC sign when this happens, and only a few
                hospital managers can watch recordings. Read our{" "}
                <Link
                  to="/privacy"
                  rel="noopener noreferrer"
                  target="_blank"
                  className="underline text-white hover:no-underline"
                >
                  privacy policy
                </Link>
                .
              </p>
            </div>
            <div className="flex justify-center md:justify-end">
              <BookingSlip
                type="Telemedicine"
                mode="Online"
                voided
                className="opacity-90"
              />
            </div>
          </div>
        </section>
      </main>

      <Footer />

      {/* Mobile-only floating bar: keeps the primary action reachable no
          matter how far the visitor has scrolled. This is the page's one
          loud element — a thin multi-colour light rotates around the pill
          and tiny crystals twinkle in the bar behind it. */}
      <div
        className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[#14213822] bg-white/95 backdrop-blur px-5 py-3"
        style={{
          paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          {crystals.map((crystal, i) => (
            <span
              key={i}
              className="absolute motion-safe:[animation:crystalTwinkle_2.8s_ease-in-out_infinite]"
              style={{
                left: crystal.left,
                top: crystal.top,
                width: crystal.size,
                height: crystal.size,
                backgroundColor: crystal.color,
                boxShadow: `0 0 6px ${crystal.color}`,
                transform: "rotate(45deg)",
                animationDelay: `${crystal.delay}ms`,
              }}
            />
          ))}
        </div>

        <BookingCta size="lg" variant="aurora" className="relative w-full" />
      </div>
      <div className="h-[76px] sm:hidden" aria-hidden="true" />
    </div>
  );
}

// Public entry point. Waits for Firebase to resolve the session (showing the
// custom preloader), then mounts the page with a real isLoggedIn flag.
export default function Home() {
  usePageMeta({
    title: "Online Doctor Consultation in Berekum, Ghana",
    description:
      "See a Holy Family Catholic Hospital, Berekum doctor by video or in person. Book General OPD or surgical consultations online and pay with mobile money.",
    path: "/",
  });
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <HealthcarePreloader label="You are welcome..." size={48} />
      </div>
    );
  }

  return <HomeContent isLoggedIn={Boolean(user)} />;
}
