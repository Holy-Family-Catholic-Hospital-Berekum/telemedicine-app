import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Header from "../shared/header";
import Footer from "../shared/footer";
import { HOSPITAL_PHONE_TEL } from "../shared/contact";
import landingImage from "../../src/assets/landingImage.jpg";
// NEW — add this file: a warm, real photo of a doctor consulting a
// patient (video call or in person), portrait orientation works best
// since it's cropped to a 4:5 frame in the hero. Drop it at:
//   src/assets/hero-consult.jpg
import heroImage from "../../src/assets/hero-consult.jpg";
// NEW — doctor details + placeholder image paths live here.
// Create this file at: src/data/doctors.js
import doctors from "../../src/data/doctors";

/**
 * Home.jsx
 * Public landing page for Holy Family Catholic Hospital's telemedicine platform.
 * Lives at the "/" route. Admin has a separate, unlinked entry point at "/admin".
 *
 * Design concept: the app's real booking flow is a MoMo reference code that
 * gets manually confirmed by hospital staff, then a consultation ID shared
 * by phone or WhatsApp — closer to a hospital appointment slip than a
 * generic "video call a doctor" product. That slip/ticket is the page's
 * throughline: it "floats" over a real photo in the hero, appears again
 * (unfilled) for each consultation type, structures the booking steps, and
 * is shown "closed" in the privacy section to represent record erasure
 * after a visit.
 *
 * CTA system:
 * - Hero: a calm white pill. It sits on the dark forest hero, so plain white
 *   is already the highest-contrast thing on screen — no gradient or shimmer
 *   needed to be found.
 * - Floating mobile bar: the page's one loud moment. A thin rotating
 *   multi-colour light runs around the pill, with a few tiny bright crystals
 *   twinkling in the bar behind it, so the action stays noticeable after the
 *   hero has scrolled away.
 * - CTA banner: the warm gold pill, quieter than the floating one.
 *
 * Images needed:
 * - src/assets/hero-consult.jpg (hero photo, see the import note above)
 * - public/doctors/*.jpg (doctor portraits, see src/data/doctors.js).
 *   Missing doctor photos degrade to an initials tile, they don't break.
 *
 * Auth (mock): isLoggedIn below is a stand-in for real auth state — there's
 * no login wired up yet. It only controls whether the header shows a
 * "Dashboard" link, purely so that UX can be reviewed before the real
 * flow exists. Swap it for whatever your auth hook/context ends up being,
 * and set the default back to false.
 *
 * Palette is scoped locally to <main> via CSS custom properties so it
 * doesn't touch the --ink / --teal / --brand-orange / --tint variables
 * Header/Footer already rely on globally.
 *
 * Notes on setup:
 * - Assumes Tailwind CSS is installed and configured (tailwind.config.js
 *   content paths pointing at src/**\/*.{js,jsx}).
 * - Assumes react-router-dom v6. If not installed: npm install react-router-dom
 * - No other dependencies required. Icons are hand-drawn inline SVG.
 */

// MOCK DATA — replace with the hospital's actual sub-services before launch.
const consultTypes = [
  {
    title: "General OPD",
    detail:
      "Everyday health concerns, check-ups, and follow-up visits with our outpatient doctors.",
    mode: "Online or in person",
    subServices: [
      "General consultation",
      "Antenatal care",
      "Child welfare & immunization",
      "Diabetes & hypertension clinic",
      "Family planning",
      "Wound care & dressing",
    ],
  },
  {
    title: "Surgical consultation",
    detail:
      "Pre-surgery assessments and post-surgery follow-ups with our surgical team.",
    mode: "Online or in person",
    subServices: [
      "Pre-surgical assessment",
      "Post-surgical follow-up",
      "General surgery",
      "Orthopedic consultation",
      "Gynecological surgery",
    ],
  },
];

const steps = [
  {
    title: "Create your account",
    detail:
      "Sign up with your name, phone number and email, then verify your email before booking.",
  },
  {
    title: "Book a Consultation",
    detail:
      "Choose General OPD or Surgical, online or in person. You may select a doctor.",
  },
  {
    title: "Pay by mobile money",
    detail: "Transfer the fee to the hospital's account.",
  },
  {
    title: "We schedule you",
    detail:
      "Our team receives your booking, then assigns you a doctor and a time.",
  },
  {
    title: "Join your consultation",
    detail:
      "We call or WhatsApp you your appointment time. Join by video, or visit us in person.",
  },
];

const quickActions = [
  {
    label: "Book OPD visit",
    href: "/book",
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
    label: "Book surgical consult",
    href: "/book",
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

// Small calendar-with-checkmark glyph shared by every "Book a consultation"
// entry point, so the action is recognisable by silhouette alone.
function BookingGlyph({ className = "" }) {
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

/**
 * Every "Book a consultation" entry point, in three weights:
 *
 *   variant="white"  — hero. Plain white pill on the dark hero; the calmest
 *                      of the three, and still the brightest thing there.
 *   variant="gold"   — CTA banner and anywhere inline. Warm gold pill.
 *   variant="aurora" — the floating mobile bar. A thin multi-colour light
 *                      rotates around the pill edge; the white face stays
 *                      readable, only the 2px rim moves.
 */
function BookingCta({
  to = "/book",
  children = "Get Care Now",
  size = "md",
  variant = "gold",
  className = "",
}) {
  const sizing =
    size === "lg"
      ? "pl-7 pr-7 py-4 text-[16px] gap-3"
      : "pl-6 pr-6 py-3.5 text-[15px] gap-2.5";

  const base = `group relative inline-flex items-center justify-center ${sizing} rounded-full font-semibold
                transition active:scale-[0.97]
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`;

  if (variant === "white") {
    return (
      <Link
        to={to}
        className={`${base} bg-white text-[var(--forest)]
                    shadow-[0_10px_26px_-12px_rgba(0,0,0,0.45)]
                    hover:bg-[var(--parchment)] hover:shadow-[0_14px_30px_-12px_rgba(0,0,0,0.5)]
                    focus-visible:outline-[#F48732] ${className}`}
      >
        <BookingGlyph className="shrink-0" />
        <span>{children}</span>
      </Link>
    );
  }

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

// The recurring visual device: a booking slip. `code` renders as a
// staggered mono reveal on the hero instance; `voided` renders a stamped
// overlay for the privacy section, representing erasure after a visit.
// `compact` shrinks the type-scale/paddings for the hero, where the slip
// sits over a photo and shouldn't eat too much of it.
function BookingSlip({
  type,
  mode,
  code,
  placeholder,
  reassurance,
  voided = false,
  tilt = false,
  animateCode = false,
  compact = false,
  className = "",
}) {
  return (
    <div
      className={`relative w-full max-w-[300px] rounded-2xl bg-[var(--parchment)] text-[var(--ink2)] ${
        tilt ? "rotate-[-2.5deg]" : ""
      } ${className}`}
      style={{ boxShadow: "0 30px 60px -24px rgba(15,20,17,0.5)" }}
    >
      <div className={compact ? "px-5 pt-4 pb-4" : "px-6 pt-6 pb-5"}>
        <p className="text-[11px] text-[var(--forest-2)]">
          Holy Family Catholic Hospital
        </p>
        <div
          className={`flex items-start justify-between gap-3 ${
            compact ? "mt-2" : "mt-3"
          }`}
        >
          <span
            className={`font-display font-medium leading-tight ${
              compact
                ? "text-[16px] sm:text-[17px]"
                : "text-[19px] sm:text-[20px]"
            }`}
          >
            {type}
          </span>
          <span className="shrink-0 rounded-full bg-[var(--forest)] px-3 py-1 text-[11px] font-medium text-[var(--parchment)]">
            {mode}
          </span>
        </div>
        <div
          className={`border-t border-dashed border-[#16211b30] ${
            compact ? "mt-3 pt-3" : "mt-5 pt-4"
          }`}
        >
          {reassurance ? (
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--forest)]/10">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M8 1.5c2.2 1.2 3.7 1.5 5.5 1.5 0 6-2.4 9.3-5.5 11.5C4.9 12.3 2.5 9 2.5 3c1.8 0 3.3-.3 5.5-1.5Z"
                    stroke="var(--forest)"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M5.6 8.1l1.6 1.6 3.2-3.4"
                    stroke="var(--forest)"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div>
                <p className="text-[12.5px] font-medium text-[var(--forest-2)]">
                  {reassurance.label}
                </p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-[#16211b8a]">
                  {reassurance.text}
                </p>
              </div>
            </div>
          ) : (
            <>
              {code ? (
                <p
                  className={`mt-1 flex font-mono tracking-[0.06em] ${
                    compact ? "text-[20px]" : "text-[25px]"
                  }`}
                >
                  {code.split("").map((char, i) => (
                    <span
                      key={i}
                      className={
                        animateCode
                          ? "motion-safe:animate-[slipReveal_0.5s_ease-out_both]"
                          : ""
                      }
                      style={
                        animateCode
                          ? { animationDelay: `${300 + i * 70}ms` }
                          : undefined
                      }
                    >
                      {char}
                    </span>
                  ))}
                </p>
              ) : (
                <p className="mt-1 font-mono text-[15px] text-[#16211b70]">
                  {placeholder}
                </p>
              )}
            </>
          )}
        </div>
      </div>
      {voided && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-6 flex items-center justify-center"
        >
          <span
            className="rotate-[-8deg] rounded-md border-[3px] border-[var(--gold)] px-4 py-1.5 text-[14px] font-medium tracking-wide text-[var(--gold)] opacity-0"
            style={{ animation: "var(--stamp-anim, none)" }}
            data-stamp
          >
            Record erased
          </span>
        </div>
      )}
    </div>
  );
}

// Doctor portrait that survives a missing file: if the image 404s (or no
// path is set yet) it falls back to an initials tile in the page palette,
// so the slider still looks finished while photos are being collected.
function DoctorPortrait({ doctor }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(doctor.image) && !failed;

  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-[var(--forest)]">
      {showImage ? (
        <img
          src={doctor.image}
          alt={`${doctor.name}, ${doctor.role} at Holy Family Catholic Hospital`}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center"
          style={{
            backgroundImage:
              "radial-gradient(120% 90% at 50% 0%, #2F5D4C 0%, #1F3D33 70%)",
          }}
        >
          <span className="font-display text-[34px] font-medium text-[var(--gold)]">
            {doctor.initials}
          </span>
        </div>
      )}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-[var(--ink2)]/75 via-transparent to-transparent"
      />
      <span className="absolute bottom-3 left-3 rounded-full bg-[var(--parchment)]/90 px-3 py-1 text-[11px] font-medium text-[var(--ink2)]">
        {doctor.availability}
      </span>
    </div>
  );
}

/**
 * Doctors slider.
 * 4 cards in frame on large screens, 2 on tablets, exactly 1 on phones.
 * Advances on its own every 5s, pauses on hover, on focus within, and when
 * the tab is hidden. Reduced-motion visitors get no auto-advance and no
 * sliding transition — the arrows and dots still work.
 */
function DoctorsSlider() {
  const [perView, setPerView] = useState(1);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const touchStartX = useRef(null);

  useEffect(() => {
    const large = window.matchMedia("(min-width: 1024px)");
    const medium = window.matchMedia("(min-width: 640px)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const apply = () => {
      setPerView(large.matches ? 4 : medium.matches ? 2 : 1);
      setReduceMotion(motion.matches);
    };
    apply();

    const watched = [large, medium, motion];
    watched.forEach((mq) => mq.addEventListener("change", apply));
    return () =>
      watched.forEach((mq) => mq.removeEventListener("change", apply));
  }, []);

  const maxIndex = Math.max(0, doctors.length - perView);

  useEffect(() => {
    setIndex((current) => Math.min(current, maxIndex));
  }, [maxIndex]);

  const next = useCallback(
    () => setIndex((current) => (current >= maxIndex ? 0 : current + 1)),
    [maxIndex],
  );
  const prev = useCallback(
    () => setIndex((current) => (current <= 0 ? maxIndex : current - 1)),
    [maxIndex],
  );

  useEffect(() => {
    if (paused || reduceMotion || maxIndex === 0) return;
    const id = window.setInterval(next, 5000);
    return () => window.clearInterval(id);
  }, [paused, reduceMotion, maxIndex, next]);

  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const onTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(delta) > 45) (delta < 0 ? next : prev)();
    touchStartX.current = null;
  };

  return (
    <div
      className="mt-10 sm:mt-12"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div
        className="overflow-hidden"
        role="region"
        aria-roledescription="carousel"
        aria-label="Our doctors"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div
          className={`flex ${reduceMotion ? "" : "transition-transform duration-700 ease-out"}`}
          style={{ transform: `translateX(-${index * (100 / perView)}%)` }}
        >
          {doctors.map((doctor, i) => {
            const visible = i >= index && i < index + perView;
            return (
              <div
                key={doctor.id}
                className="shrink-0 px-2 sm:px-3"
                style={{ flexBasis: `${100 / perView}%` }}
                aria-hidden={visible ? undefined : true}
              >
                <article className="h-full rounded-3xl border border-[#14213814] bg-white p-3 shadow-[0_18px_40px_-28px_rgba(15,20,17,0.6)]">
                  <DoctorPortrait doctor={doctor} />
                  <div className="px-1.5 pb-1 pt-4">
                    <h3 className="font-display text-[17px] font-medium leading-tight text-[var(--ink2)]">
                      {doctor.name}
                    </h3>
                    <p className="mt-1 text-[13px] font-medium text-[var(--forest-2)]">
                      {doctor.role}
                    </p>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-[#142138b3]">
                      {doctor.focus}
                    </p>
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-7 flex items-center justify-center gap-5">
        <button
          type="button"
          onClick={prev}
          aria-label="Previous doctors"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#14213826] text-[var(--forest)]
                     transition hover:border-[var(--forest)] hover:bg-[var(--forest)] hover:text-white
                     focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--forest)]"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 5l-6 5 6 5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div className="flex items-center gap-2">
          {Array.from({ length: maxIndex + 1 }).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show doctors ${i + 1} of ${maxIndex + 1}`}
              aria-current={i === index}
              className={`h-2 rounded-full transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--forest)] ${
                i === index
                  ? "w-6 bg-[var(--forest)]"
                  : "w-2 bg-[#14213833] hover:bg-[#14213866]"
              }`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={next}
          aria-label="Next doctors"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#14213826] text-[var(--forest)]
                     transition hover:border-[var(--forest)] hover:bg-[var(--forest)] hover:text-white
                     focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--forest)]"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M8 5l6 5-6 5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * A soft warm glow that trails the pointer, sitting behind everything the
 * visitor can click. Mouse-only: skipped entirely on touch screens and for
 * reduced-motion visitors, who still get the custom cursor art itself.
 */
function CursorGlow() {
  const ref = useRef(null);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const el = ref.current;
    if (!el) return;

    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let frame;
    let seen = false;

    const onMove = (e) => {
      targetX = e.clientX;
      targetY = e.clientY;
      if (!seen) {
        seen = true;
        x = targetX;
        y = targetY;
        el.style.opacity = "1";
      }
    };
    const onLeave = () => {
      el.style.opacity = "0";
    };

    const loop = () => {
      x += (targetX - x) * 0.18;
      y += (targetY - y) * 0.18;
      el.style.transform = `translate3d(${x - 28}px, ${y - 28}px, 0)`;
      frame = requestAnimationFrame(loop);
    };

    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    frame = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[60] h-14 w-14 rounded-full opacity-0 blur-[10px] transition-opacity duration-300"
      style={{
        background:
          "radial-gradient(circle, rgba(255,209,102,0.55) 0%, rgba(248,133,53,0.32) 45%, rgba(248,133,53,0) 72%)",
      }}
    />
  );
}

// Triggers a stamp reveal once the privacy section scrolls into view.
// Respects reduced motion by showing the stamp already in place.
function useStampOnce() {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const el = ref.current;
    if (!el) return;
    if (reduceMotion) {
      setReady(true);
      return;
    }
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
  }, []);

  return { ref, ready };
}

export default function Home() {
  const { ref: privacyRef, ready: stampReady } = useStampOnce();

  // MOCK — no auth wired up yet. Stands in for real auth state so the
  // header's new "Dashboard" link can be reviewed; swap for a real
  // hook/context and set the default back to false once accounts exist.
  const [isLoggedIn] = useState(true);

  return (
    <div className="font-body text-[#142138] bg-white overflow-x-hidden">
      <CursorGlow />
      <Header variant="full" isLoggedIn={isLoggedIn} />

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
          @keyframes heroTextRise {
            from { opacity: 0; transform: translateY(16px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes heroImageIn {
            from { opacity: 0; transform: translateY(14px) scale(0.985); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          @keyframes pulseDraw {
            from { stroke-dashoffset: 1; }
            to { stroke-dashoffset: 0; }
          }
          @keyframes slipFloat {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-8px); }
          }
          @keyframes slipReveal {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes stampIn {
            from { opacity: 0; transform: rotate(-8deg) scale(1.4); }
            to { opacity: 1; transform: rotate(-8deg) scale(1); }
          }

          /* ---- Custom pointer ----
             A bright orange dot inside a gold ring everywhere, switching to
             a filled heart over anything clickable, so the cursor carries the
             same "care" idea that runs through the page. Hotspots are centred
             on the dot / on the heart's top notch. Touch devices ignore all
             of this. */
          html, body {
            cursor: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="10" fill="none" stroke="%23FFD166" stroke-width="1.5" opacity="0.9"/><circle cx="14" cy="14" r="5.5" fill="%23F88535" stroke="%23FFFFFF" stroke-width="1.5"/></svg>') 14 14, auto;
          }
          a, button, [role="button"], summary, label, select,
          input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"] {
            cursor: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30"><path d="M15 26.5S3.5 18.6 3.5 11.6A6.1 6.1 0 0 1 15 8.4 6.1 6.1 0 0 1 26.5 11.6C26.5 18.6 15 26.5 15 26.5Z" fill="%232F8BFF" stroke="%23FFFFFF" stroke-width="2" stroke-linejoin="round"/></svg>') 15 8, pointer;
          }
          input[type="text"], input[type="email"], input[type="tel"],
          input[type="password"], input[type="number"], input[type="search"], textarea {
            cursor: text;
          }
          @media (hover: none), (pointer: coarse) {
            html, body, a, button, [role="button"], summary, label, select,
            input[type="submit"], input[type="button"] { cursor: auto; }
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
          @media (prefers-reduced-motion: reduce) {
            [class*="animate-["] { animation: none !important; opacity: 1 !important; }
          }
        `}</style>

        {/* ---------- Hero ---------- */}
        <section className="relative isolate overflow-hidden bg-white">
          <div
            aria-hidden="true"
            className="absolute -right-32 -top-36 h-[560px] w-[560px] rounded-full blur-3xl opacity-70"
            style={{
              background:
                "radial-gradient(circle, rgba(0,149,217,0.18) 0%, rgba(0,149,217,0.06) 42%, transparent 72%)",
            }}
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-48 left-[-12%] h-[520px] w-[520px] rounded-full blur-3xl opacity-75"
            style={{
              background:
                "radial-gradient(circle, rgba(248,133,53,0.16) 0%, rgba(248,133,53,0.05) 48%, transparent 72%)",
            }}
          />
          <div
            aria-hidden="true"
            className="absolute left-[42%] top-[34%] h-44 w-44 rounded-full bg-[#0095D9]/[0.055] blur-3xl"
          />
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#0095D9]/20 to-transparent"
          />

          <div className="relative mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <div className="min-h-[calc(100svh-80px)] py-10 sm:py-14 lg:py-16 flex items-center">
              <div className="grid w-full items-center gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-0">
                {/* Copy */}
                <div className="relative z-20 max-w-2xl pt-3 text-center lg:pt-0 lg:text-left motion-safe:[animation:heroTextRise_0.7s_ease-out_both]">
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#0095D9]/15 bg-[#0095D9]/[0.055] px-3.5 py-2 text-[12px] font-semibold text-[#0079B2] shadow-[0_10px_30px_-22px_rgba(0,149,217,0.5)] backdrop-blur-sm">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-[#0095D9]/10">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M8 14S1.8 10.2 1.8 5.6A3.8 3.8 0 0 1 8 3a3.8 3.8 0 0 1 6.2 2.6C14.2 10.2 8 14 8 14Z"
                          fill="#F88535"
                        />
                      </svg>
                    </span>
                    Care and compassion redefined
                  </div>

                  <h1 className="mt-6 max-w-[760px] font-display text-[clamp(40px,6vw,72px)] leading-[1.02] font-medium tracking-[-0.045em] text-[var(--ink2)]">
                    Quality healthcare{" "}
                    <span className="relative inline-block text-[#0095D9]">
                      at your doorstep.
                      <span
                        aria-hidden="true"
                        className="absolute -bottom-2 left-0 h-[5px] w-1/2 rounded-full bg-gradient-to-r from-[#F88535] to-[#F88535]/0"
                      />
                    </span>
                  </h1>

                  <p className="mx-auto mt-6 max-w-xl text-[clamp(15px,2vw,18px)] leading-[1.75] text-[#142138B8] lg:mx-0">
                    General OPD and surgical consultations, online or in person.
                    No card, no waiting room, just your phone or laptop.
                  </p>

                  <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center lg:justify-start">
                    <BookingCta
                      size="lg"
                      variant="gold"
                      className="shadow-[0_18px_38px_-16px_rgba(248,133,53,0.55)] hover:-translate-y-0.5"
                    />
                    <a
                      href={HOSPITAL_PHONE_TEL}
                      className="inline-flex items-center gap-2 rounded-full border border-[#14213820] bg-white px-5 py-3.5 text-[14px] font-semibold text-[var(--ink)] shadow-[0_12px_30px_-24px_rgba(20,33,56,0.45)] transition hover:-translate-y-0.5 hover:border-[#0095D9]/40 hover:text-[#0095D9]"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 20 20"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M4.5 3.5h2.7c.5 0 .9.3 1 .8l.7 2.6c.1.4 0 .9-.3 1.2L7.3 9.4c1 2.1 2.7 3.8 4.8 4.8l1.3-1.3c.3-.3.8-.4 1.2-.3l2.6.7c.5.1.8.5.8 1v2.7c0 .6-.5 1-1 1-6.9 0-12.5-5.6-12.5-12.5 0-.5.4-1 1-1z"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Or call the hospital directly
                    </a>
                  </div>

                  <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 lg:justify-start">
                    {[
                      "Data erased after every visit",
                      "Same doctors as our hospital",
                    ].map((item) => (
                      <li
                        key={item}
                        className="flex items-center gap-2 text-[12.5px] font-medium text-[#142138A8]"
                      >
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0095D9]/[0.08] text-[#0095D9]">
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 16 16"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path
                              d="M3.5 8.4l3 3 6-6.8"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Oversized hero photography with feathered edges — no card or heart frame. */}
                <div className="relative mt-0 min-h-[430px] sm:min-h-[560px] lg:-mr-24 lg:min-h-[700px] motion-safe:[animation:heroImageIn_0.9s_ease-out_0.15s_both]">
                  <div
                    aria-hidden="true"
                    className="absolute right-[8%] top-[13%] h-72 w-72 rounded-full blur-3xl opacity-80"
                    style={{
                      background:
                        "radial-gradient(circle, rgba(0,149,217,0.20) 0%, rgba(0,149,217,0.08) 42%, transparent 72%)",
                    }}
                  />
                  <div
                    aria-hidden="true"
                    className="absolute bottom-[10%] right-[8%] h-56 w-56 rounded-full blur-3xl opacity-80"
                    style={{
                      background:
                        "radial-gradient(circle, rgba(248,133,53,0.22) 0%, rgba(248,133,53,0.07) 45%, transparent 72%)",
                    }}
                  />

                  <div
                    className="absolute inset-0"
                    style={{
                      // Widened and re-centred so the fade timing is the same
                      // "distance" from the visible frame on both sides — the
                      // old 58%-centred circle sat closer to the right edge
                      // than the left, so the right side hit its fade-out
                      // sooner even though the numbers looked symmetric.
                      WebkitMaskImage:
                        "radial-gradient(94% 92% at 62% 48%, #000 50%, rgba(0,0,0,.96) 70%, transparent 100%)",
                      maskImage:
                        "radial-gradient(94% 92% at 62% 48%, #000 50%, rgba(0,0,0,.96) 70%, transparent 100%)",
                      filter: "drop-shadow(0 34px 55px rgba(0,70,105,0.18))",
                    }}
                  >
                    <img
                      src={heroImage}
                      alt="A doctor at Holy Family Catholic Hospital speaking warmly with a patient"
                      className="h-full w-full object-cover object-[68%_center]"
                    />
                    <div
                      aria-hidden="true"
                      className="absolute inset-0"
                      style={{
                        background:
                          "linear-gradient(90deg, #FFFFFF 0%, rgba(255,255,255,.72) 10%, transparent 34%)",
                      }}
                    />
                    <div
                      aria-hidden="true"
                      className="absolute inset-0"
                      style={{
                        background:
                          "linear-gradient(180deg, rgba(255,255,255,.68) 0%, transparent 20%, transparent 72%, #FFFFFF 100%)",
                      }}
                    />
                    <div
                      aria-hidden="true"
                      className="absolute inset-0"
                      style={{
                        // Was a default "circle" (sized to the farthest
                        // corner), which is a much longer reach on the left
                        // than the right once the centre sits right-of-middle
                        // — that's what was quietly washing out the right
                        // edge sooner than the left. Giving it explicit,
                        // equal-ish radii fixes that lopsidedness directly.
                        background:
                          "radial-gradient(92% 90% at 60% 46%, transparent 50%, rgba(255,255,255,.05) 74%, rgba(255,255,255,.85) 100%)",
                      }}
                    />
                  </div>

                  <div className="absolute bottom-[12%] left-[7%] hidden sm:flex items-center gap-2.5 rounded-full border border-white/70 bg-white/85 px-4 py-2.5 text-[12px] font-semibold text-[#142138] shadow-[0_18px_45px_-24px_rgba(20,33,56,0.35)] backdrop-blur-md">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0095D9] text-white">
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M8 1.5c2.2 1.2 3.7 1.5 5.5 1.5 0 6-2.4 9.3-5.5 11.5C4.9 12.3 2.5 9 2.5 3c1.8 0 3.3-.3 5.5-1.5Z"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinejoin="round"
                        />
                        <path
                          d="m5.6 8.1 1.6 1.6 3.2-3.4"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    Trusted hospital care
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- How it works ---------- */}
        <section
          id="how-it-works"
          className="py-16 sm:py-24 bg-[var(--parchment)]"
        >
          <div className="mx-auto max-w-3xl px-5 sm:px-8">
            <h2 className="font-display text-[26px] sm:text-[30px] font-medium text-[var(--ink2)]">
              How you get Quality Healthcare
            </h2>

            <ol className="mt-10 sm:mt-14 relative border-l-2 border-dashed border-[var(--forest)]/25 pl-6 sm:pl-8 space-y-9 sm:space-y-10">
              {steps.map((item, i) => (
                <li key={item.title} className="relative">
                  <span className="absolute -left-[31px] sm:-left-[39px] top-0 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--forest)] text-[12px] font-medium text-[var(--parchment)]">
                    {i + 1}
                  </span>
                  <h3 className="font-medium text-[15px] sm:text-[16px] text-[var(--ink2)]">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-[14px] sm:text-[15px] leading-relaxed text-[#16211bb3]">
                    {item.detail}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------- Consultation types ---------- */}
        <section id="services" className="py-16 sm:py-24">
          <div className="mx-auto max-w-5xl px-5 sm:px-8">
            <h2 className="font-display text-[26px] sm:text-[30px] font-medium max-w-lg text-[var(--ink2)]">
              Choose the care you need
            </h2>
            <p className="mt-3 text-[15px] sm:text-[16px] text-[#142138cc] max-w-lg">
              Both consultation types are available online or in person,
              whichever works better for you.
            </p>

            <div className="mt-10 sm:mt-14 grid sm:grid-cols-2 gap-8 sm:gap-10">
              {consultTypes.map((service) => (
                <div key={service.title}>
                  <Link
                    to="/book"
                    className="group block rounded-2xl transition
                               focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--forest)]"
                  >
                    <div className="transition duration-300 group-hover:-translate-y-1.5">
                      <BookingSlip
                        type={service.title}
                        mode={service.mode}
                        placeholder=""
                        className="max-w-none mx-auto sm:mx-0 transition duration-300 group-hover:shadow-[0_36px_70px_-24px_rgba(15,20,17,0.55)]"
                      />
                    </div>
                    <p className="mt-4 text-[14px] leading-relaxed text-[#142138b3] text-center sm:text-left max-w-sm mx-auto sm:mx-0">
                      {service.detail}
                    </p>
                    <span className="mt-2 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-[var(--forest-2)] transition group-hover:text-[var(--forest)]">
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

                  {/* Sub-services: kept outside the Link above so this stays
                      a plain list, not a nested interactive element. Mock
                      data, see consultTypes at the top of this file. */}
                  <ul className="mt-5 flex flex-wrap justify-center sm:justify-start gap-2 max-w-sm mx-auto sm:mx-0">
                    {service.subServices.map((item) => (
                      <li
                        key={item}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--forest)]/15 bg-[var(--forest)]/[0.04] px-3 py-1.5 text-[12.5px] text-[var(--forest-2)]"
                      >
                        <CheckGlyph />
                        {item}
                      </li>
                    ))}
                  </ul>
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
              <p className="text-[14px] sm:text-[15px] leading-relaxed text-[#142138b3] max-w-md">
                Whichever you choose, the same doctors who see you at the
                hospital are the ones who confirm and hold your consultation.
              </p>
            </div>
          </div>
        </section>

        {/* ---------- Meet your doctors ---------- */}
        <section id="doctors" className="pb-16 sm:pb-24">
          <div className="mx-auto max-w-6xl px-3 sm:px-5">
            <div className="px-2 sm:px-3">
              <h2 className="font-display text-[26px] sm:text-[30px] font-medium text-[var(--ink2)]">
                Meet your doctors
              </h2>
              <p className="mt-3 max-w-lg text-[15px] sm:text-[16px] text-[#142138cc]">
                You'll be assigned to one of them when your payment is
                confirmed, based on what you're being seen for.
              </p>
            </div>

            <DoctorsSlider />
          </div>
        </section>

        {/* ---------- CTA banner ---------- */}
        <section className="px-5 sm:px-8 py-16 sm:py-24">
          <div className="mx-auto max-w-6xl rounded-3xl bg-[#0095D9] text-[var(--parchment)] px-6 sm:px-10 py-10 sm:py-14 flex flex-col md:flex-row md:items-center gap-8 md:gap-10">
            <div className="flex-1 text-center md:text-left">
              <h2 className="font-display text-[24px] sm:text-[28px] font-medium">
                Ready when you are
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-[var(--parchment)]/70 max-w-sm mx-auto md:mx-0">
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
                  className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-[var(--parchment)]/20 px-4 py-2.5 text-[13.5px] font-medium text-[var(--parchment)]/90
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
                How We Handle Your data
              </h2>
              <p className="mt-4 text-[15px] sm:text-[16px] leading-relaxed text-[var(--parchment)]/75">
                Once your appointment ends, the booking details are permanently
                deleted from our systems. We keep an audio record of what was
                discussed for security purposes and anonymous, non-identifying
                statistics are kept to help us improve the service.
              </p>
            </div>
            <div className="flex justify-center md:justify-end">
              <BookingSlip
                type="Telemedicine"
                mode="Online or In-person"
                code=""
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
