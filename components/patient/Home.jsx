import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Header from "../shared/Header";
import Footer from "../shared/Footer";
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
 * CTA system (updated):
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

const consultTypes = [
  {
    title: "General OPD",
    detail:
      "Everyday health concerns, check-ups, and follow-up visits with our outpatient doctors.",
    mode: "Online or in person",
  },
  {
    title: "Surgical consultation",
    detail:
      "Pre-surgery assessments and post-surgery follow-ups with our surgical team.",
    mode: "Online or in person",
  },
];

const steps = [
  {
    title: "Create your account",
    detail:
      "Sign up with your name, phone number and email, then verify your email before booking.",
  },
  {
    title: "Book and get a reference",
    detail:
      "Choose General OPD or Surgical, online or in person, and you'll be issued a booking reference code.",
  },
  {
    title: "Pay by mobile money",
    detail:
      "Transfer the fee to the hospital's MoMo line with your reference in the note, then submit your details in the app.",
  },
  {
    title: "We confirm and schedule you",
    detail:
      "Our team checks your payment against our own MoMo records, then assigns you a doctor and a time.",
  },
  {
    title: "Join your consultation",
    detail:
      "We call or WhatsApp you your appointment time and consultation ID. Enter it to join by video, or visit us in person.",
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

// Faint background iconography for the hero — kept low-opacity and out of
// the way of content, just enough to read as "medical" at a glance rather
// than as illustration competing with the headline or photo.
const medicalSymbols = [
  {
    // Cross
    path: "M12 4v16 M4 12h16",
    box: "top-6 left-5 sm:top-10 sm:left-10",
    size: 30,
    rotate: -8,
    opacity: 0.16,
  },
  {
    // Heart outline
    path: "M12 20s-7-4.35-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 5c-2.5 4.65-9.5 9-9.5 9Z",
    box: "top-8 right-6 sm:top-14 sm:right-14",
    size: 26,
    rotate: 6,
    opacity: 0.14,
  },
  {
    // Stethoscope, simplified
    path: "M6 3v5a4 4 0 0 0 8 0V3 M9 12v2.5a5.5 5.5 0 0 0 5.5 5.5 3.5 3.5 0 0 0 3.5-3.5V15 M18.5 14.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
    box: "hidden sm:block sm:bottom-10 sm:left-[8%]",
    size: 46,
    rotate: -10,
    opacity: 0.1,
  },
  {
    // Pill capsule
    path: "M6.5 14 14 6.5a4 4 0 1 1 5.5 5.5L12 19.5a4 4 0 1 1-5.5-5.5Z M9 11.5l4 4",
    box: "hidden md:block md:top-[42%] md:left-[38%]",
    size: 34,
    rotate: 18,
    opacity: 0.08,
  },
];

// The hero photo is cropped to this heart — the frame is the message, so
// it's a real heart silhouette rather than a rounded card with a heart
// stuck on it. Drawn in a 100x92 box; every layer of the hero frame (glow,
// dashed outline, rim) reuses this one path so they stay in register.
const HEART_PATH =
  "M50 88.5 C50 88.5 5.5 60.5 5.5 31.5 C5.5 16.4 16.8 5.5 30.6 5.5 C39.6 5.5 46.9 10 50 17.2 C53.1 10 60.4 5.5 69.4 5.5 C83.2 5.5 94.5 16.4 94.5 31.5 C94.5 60.5 50 88.5 50 88.5 Z";

// A handful of small sparks placed just outside the heart's edge in the
// hero — 4-point stars and plain dots, not rays. Positions are plotted by
// eye against the heart path so each sits in open space beside it rather
// than on a regular ring. Kept sparse and small on purpose: this is meant
// to read as a quiet detail, not a special effect.
const heroSparks = [
  {
    x: 50,
    y: 3,
    size: 3.4,
    shape: "star",
    color: "#FFFFFF",
    opacity: 0.95,
    delay: 0,
  },
  {
    x: 84,
    y: 14,
    size: 1.6,
    shape: "dot",
    color: "#FFFFFF",
    opacity: 0.8,
    delay: 900,
  },
  {
    x: 92,
    y: 40,
    size: 2.6,
    shape: "star",
    color: "#F48732",
    opacity: 0.9,
    delay: 1700,
  },
  {
    x: 80,
    y: 68,
    size: 1.4,
    shape: "dot",
    color: "#FFFFFF",
    opacity: 0.7,
    delay: 500,
  },
  {
    x: 16,
    y: 12,
    size: 2.2,
    shape: "dot",
    color: "#FFFFFF",
    opacity: 0.75,
    delay: 1250,
  },
  {
    x: 6,
    y: 42,
    size: 3,
    shape: "star",
    color: "#FFFFFF",
    opacity: 0.9,
    delay: 300,
  },
  {
    x: 20,
    y: 70,
    size: 1.6,
    shape: "dot",
    color: "#F48732",
    opacity: 0.75,
    delay: 2000,
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

// A minimal 4-point spark glyph — two crossed diamonds, drawn with a path
// rather than a star polygon so it reads as a soft twinkle, not a decal.
function SparkGlyph({ x, y, size, color, opacity }) {
  const s = size;
  return (
    <path
      d={`M${x} ${y - s} Q${x + s * 0.22} ${y - s * 0.22} ${x + s} ${y} Q${x + s * 0.22} ${y + s * 0.22} ${x} ${y + s} Q${x - s * 0.22} ${y + s * 0.22} ${x - s} ${y} Q${x - s * 0.22} ${y - s * 0.22} ${x} ${y - s} Z`}
      fill={color}
      opacity={opacity}
    />
  );
}

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
  children = "Book a consultation",
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
          <p className="text-[11px] text-[#16211b8a]">Booking reference</p>
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

  return (
    <div className="font-body text-[#142138] bg-white overflow-x-hidden">
      <CursorGlow />
      <Header variant="full" />

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
            from { opacity: 0; transform: translateY(10px) scale(0.97); }
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
          /* The heart frame holds still; a few small sparks around it
             twinkle gently on staggered offsets — a quiet detail, not an
             effect that competes with the photo. */
          @keyframes sparkTwinkle {
            0%, 100% { opacity: .35; transform: scale(0.85); }
            50% { opacity: 1; transform: scale(1); }
          }

          /* ---- Custom pointer ----
             A bright orange dot inside a gold ring everywhere, switching to
             a filled heart over anything clickable, so the cursor carries the
             same "care" idea as the hero frame. Hotspots are centred on the
             dot / on the heart's top notch. Touch devices ignore all of this. */
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
        <section className="relative overflow-hidden bg-[var(--brand-blue)]">
          {/* soft glow accents */}
          <div
            aria-hidden="true"
            className="absolute -top-20 -right-16 h-64 w-64 rounded-full bg-white opacity-[0.14] blur-3xl"
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-[var(--brand-orange)] opacity-[0.12] blur-3xl"
          />

          {medicalSymbols.map((symbol, i) => (
            <svg
              key={i}
              aria-hidden="true"
              viewBox="0 0 24 24"
              width={symbol.size}
              height={symbol.size}
              className={`absolute pointer-events-none ${symbol.box}`}
              style={{ transform: `rotate(${symbol.rotate}deg)` }}
            >
              <path
                d={symbol.path}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={symbol.opacity}
              />
            </svg>
          ))}
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-[0.05]"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, #FFFFFF 0px, #FFFFFF 1px, transparent 1px, transparent 28px)",
            }}
          />

          {/* Heartbeat pulse line — the one clinical motif in the hero,
              drawn in once on load. Reduced-motion users get it already
              drawn (see the inline strokeDashoffset default below). */}
          <svg
            aria-hidden="true"
            viewBox="0 0 800 120"
            preserveAspectRatio="none"
            className="absolute inset-x-0 top-[34%] sm:top-1/2 -translate-y-1/2 w-full h-16 sm:h-28 opacity-[0.22]"
          >
            <path
              d="M0 60 H260 L295 20 L330 100 L360 60 H430 L455 35 L480 85 L505 60 H800"
              fill="none"
              stroke="var(--brand-orange)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength="1"
              style={{ strokeDasharray: 1, strokeDashoffset: 0 }}
              className="motion-safe:[animation:pulseDraw_2.2s_ease-out_0.3s_both]"
            />
          </svg>

          {/* flex-col by default, side-by-side from md up. */}
          <div className="relative mx-auto max-w-6xl px-5 sm:px-8 pt-8 sm:pt-16 pb-14 sm:pb-24 flex flex-col md:flex-row md:items-center gap-12 md:gap-14">
            <div className="min-w-0 text-center md:text-left md:flex-1 motion-safe:[animation:heroTextRise_0.7s_ease-out_both]">
              <p className="text-[13px] font-medium text-[#16211B]">
                Telemedicine from Holy Family Catholic Hospital
              </p>
              <h1 className="mt-4 font-display text-[clamp(28px,7.5vw,46px)] leading-[1.18] font-medium text-white">
                Consult with a doctor in the comfort of your home.
              </h1>
              <p className="mt-5 text-[clamp(15px,4vw,17px)] leading-relaxed text-white/80 max-w-md mx-auto md:mx-0">
                General OPD and surgical consultations, online or in person. No
                card, no waiting room, just your phone and a reference code.
              </p>

              <div className="mt-8 flex flex-col sm:flex-row items-center sm:items-start gap-4 justify-center md:justify-start">
                <BookingCta size="lg" variant="white" />
                <a
                  href={HOSPITAL_PHONE_TEL}
                  className="text-[14px] font-medium text-white/85 underline decoration-[var(--brand-orange)]/60 underline-offset-4
                             hover:text-white hover:decoration-[var(--brand-orange)] transition"
                >
                  Or call the hospital directly
                </a>
              </div>
            </div>

            {/* Photo frame: the photo is cropped into a heart — love and
                compassion is the whole point of the hospital, so it's the
                frame itself rather than a badge stuck on a card. The heart
                itself is static; only a few small sparks beside it
                flicker. Needs src/assets/hero-consult.jpg. */}
            <div className="relative min-w-0 w-full md:flex-1 md:max-w-[440px] lg:max-w-[520px] mx-auto md:mx-0 pb-24 sm:pb-28 motion-safe:[animation:heroImageIn_0.8s_ease-out_0.15s_both]">
              <div className="relative mx-auto w-full max-w-[300px] sm:max-w-[360px] lg:max-w-[440px]">
                {/* white shadow/glow bleeding out from behind the heart */}
                <div aria-hidden="true" className="absolute -inset-6">
                  <svg
                    viewBox="0 0 100 92"
                    className="h-full w-full opacity-70 blur-2xl"
                  >
                    <path d={HEART_PATH} fill="#FFFFFF" />
                  </svg>
                </div>

                {/* small sparks scattered just outside the heart's edge */}
                <div aria-hidden="true" className="absolute inset-0">
                  <svg
                    viewBox="0 0 100 92"
                    className="h-full w-full overflow-visible"
                  >
                    {heroSparks.map((spark, i) => (
                      <g
                        key={i}
                        className="motion-safe:[animation:sparkTwinkle_3.4s_ease-in-out_infinite]"
                        style={{
                          animationDelay: `${spark.delay}ms`,
                          transformOrigin: `${spark.x}px ${spark.y}px`,
                        }}
                      >
                        {spark.shape === "star" ? (
                          <SparkGlyph
                            x={spark.x}
                            y={spark.y}
                            size={spark.size}
                            color={spark.color}
                            opacity={spark.opacity}
                          />
                        ) : (
                          <circle
                            cx={spark.x}
                            cy={spark.y}
                            r={spark.size / 2}
                            fill={spark.color}
                            opacity={spark.opacity}
                          />
                        )}
                      </g>
                    ))}
                  </svg>
                </div>

                {/* the photo, clipped to the heart, with a white rim */}
                <svg
                  viewBox="0 0 100 92"
                  role="img"
                  aria-label="A doctor at Holy Family Catholic Hospital speaking with a patient"
                  className="relative w-full"
                  style={{
                    filter: "drop-shadow(0 22px 40px rgba(255,255,255,0.45))",
                  }}
                >
                  <defs>
                    <clipPath id="heroHeartClip">
                      <path d={HEART_PATH} />
                    </clipPath>
                    <linearGradient
                      id="heroHeartWash"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="40%"
                        stopColor="var(--brand-blue-deep)"
                        stopOpacity="0"
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--brand-blue-deep)"
                        stopOpacity="0.85"
                      />
                    </linearGradient>
                  </defs>
                  <g clipPath="url(#heroHeartClip)">
                    <rect width="100" height="92" fill="var(--ink2)" />
                    <image
                      href={heroImage}
                      x="0"
                      y="0"
                      width="100"
                      height="92"
                      preserveAspectRatio="xMidYMid slice"
                    />
                    <rect width="100" height="92" fill="url(#heroHeartWash)" />
                  </g>
                  <path
                    d={HEART_PATH}
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              <div className="absolute -bottom-2 sm:-bottom-4 left-1/2 -translate-x-1/2 sm:left-auto sm:right-0 sm:translate-x-0 motion-safe:[animation:slipFloat_5s_ease-in-out_1.3s_infinite]">
                <BookingSlip
                  type="General OPD"
                  mode="Online"
                  code="8K3M2Q"
                  animateCode
                  compact
                  tilt
                  className="w-[190px] sm:w-[215px] shadow-[0_24px_48px_-16px_rgba(0,0,0,0.55)]"
                />
              </div>
            </div>
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
                <Link
                  key={service.title}
                  to="/book"
                  className="group block rounded-2xl transition
                             focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--forest)]"
                >
                  <div className="transition duration-300 group-hover:-translate-y-1.5">
                    <BookingSlip
                      type={service.title}
                      mode={service.mode}
                      placeholder="Issued once you book"
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

        {/* ---------- How it works ---------- */}
        <section
          id="how-it-works"
          className="py-16 sm:py-24 bg-[var(--parchment)]"
        >
          <div className="mx-auto max-w-3xl px-5 sm:px-8">
            <h2 className="font-display text-[26px] sm:text-[30px] font-medium text-[var(--ink2)]">
              How your booking gets confirmed
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
          className={`relative overflow-hidden bg-[var(--ink2)] py-16 sm:py-24 ${
            stampReady ? "stamp-ready" : ""
          }`}
        >
          <div className="relative mx-auto max-w-6xl px-5 sm:px-8 grid md:grid-cols-[1.1fr_0.9fr] gap-10 items-center">
            <div className="max-w-xl text-center md:text-left">
              <h2 className="font-display text-[24px] sm:text-[28px] font-medium text-[var(--parchment)]">
                Your consultation, then it's gone
              </h2>
              <p className="mt-4 text-[15px] sm:text-[16px] leading-relaxed text-[var(--parchment)]/75">
                Once your appointment ends, the booking and consultation details
                are permanently deleted from our systems. We don't keep a record
                of what was discussed. Only anonymous, non-identifying
                statistics are kept to help us improve the service.
              </p>
            </div>
            <div className="flex justify-center md:justify-end">
              <BookingSlip
                type="General OPD"
                mode="Closed"
                code="8K3M2Q"
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
