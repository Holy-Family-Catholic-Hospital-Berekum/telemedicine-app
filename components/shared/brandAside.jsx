// BrandAside.jsx — the fixed brand panel shown alongside the booking flow
// and the dashboard on wide screens. Same anatomy as AuthAside (logo +
// hospital name, headline/body/checklist, ECG line, footer note) but two
// things are new here:
//
// 1. It's `position: fixed` instead of sitting in normal flow, so it never
//    scrolls with the page — the parent page just needs to reserve the
//    same width as margin/padding (see the `lg:ml-[…]` note in
//    Dashboard.jsx / BookConsultation.jsx).
// 2. The background is an auto-playing slider: drop in as many photos as
//    you want via the `images` prop and they crossfade smoothly forever,
//    no JS state, no controls needed. With a single image it just sits
//    static (no pointless pulsing).
//
// Only three colors are used anywhere in this file: brand orange
// (#F88535), brand blue (#0095D9), and white. Everything else (the photo
// overlay tint, the checklist dot) is one of those three at reduced
// opacity — nothing else has been introduced.
//
// ASSUMPTION: lives at src/components/shared/BrandAside.jsx, alongside
// header.jsx and footer.jsx. Update the two asset import paths below if
// your project keeps assets somewhere else.
import { Link } from "react-router-dom";
import logo from "../../src/assets/logo.png";

// Reuse the same photo used on sign-in/sign-up by default. To get an
// actual multi-photo slider, import more photos and list them here, e.g.
import sidebarImage1 from "../../images/sidebarImages/sidebarImage1.jpg";
import sidebarImage2 from "../../images/sidebarImages/sidebarImage2.jpg";
import sidebarImage3 from "../../images/sidebarImages/sidebarImage3.jpg";
import sidebarImage4 from "../../images/sidebarImages/sidebarImage4.jpg";

import authBgPhoto from "../../src/assets/auth-bg.jpg";

const DEFAULT_SLIDES = [
  authBgPhoto,
  sidebarImage1,
  sidebarImage2,
  sidebarImage3,
  sidebarImage4,
];

// How long (seconds) each photo stays fully visible before crossfading
// into the next one. Total loop length = SLIDE_SECONDS * number of photos.
const SLIDE_SECONDS = 5;
// How long (seconds) the crossfade itself takes.
const FADE_SECONDS = 1.2;

export default function BrandAside({
  heading,
  body,
  points = [],
  images = DEFAULT_SLIDES,
  // Kept for compatibility with existing callers — no longer changes the
  // color (there's only one brand gradient now), but callers can still
  // pass it without needing an update.
  tone,
}) {
  const slideCount = images.length;
  const isSlideshow = slideCount > 1;
  const cycleSeconds = SLIDE_SECONDS * slideCount;

  // Expressed as % of the *shared* animation duration (cycleSeconds), so
  // each photo's own delay just shifts where in that shared cycle its
  // local 0% lands — this is what makes the crossfade line up edge to
  // edge with no gap and no double-exposure.
  const fadeInPct = (FADE_SECONDS / cycleSeconds) * 100;
  const fadeOutStartPct = ((SLIDE_SECONDS - FADE_SECONDS) / cycleSeconds) * 100;

  return (
    <aside
      className="hidden lg:flex lg:flex-col lg:justify-between
                 fixed top-0 left-0 z-20 h-screen w-[340px] xl:w-[380px]
                 shrink-0 overflow-hidden px-9 py-10 text-white"
    >
      {isSlideshow && (
        <style>{`
          @keyframes brandAsideCrossfade {
            0% { opacity: 0; }
            ${fadeInPct}% { opacity: 1; }
            ${fadeOutStartPct}% { opacity: 1; }
            100% { opacity: 0; }
          }
        `}</style>
      )}

      {/* ---- background photo(s) ---- */}
      {images.map((src, i) => (
        <div
          key={src + i}
          aria-hidden="true"
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${src})`,
            opacity: isSlideshow ? 0 : 1,
            animation: isSlideshow
              ? `brandAsideCrossfade ${cycleSeconds}s ease-in-out infinite`
              : "none",
            animationDelay: isSlideshow ? `${i * SLIDE_SECONDS}s` : undefined,
          }}
        />
      ))}

      {/* Brand-color wash over the photo(s) — the only two accent colors
          used anywhere in this panel, blended into each other. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(165deg, rgba(248,133,53,0.82) 0%, rgba(0,149,217,0.82) 100%)",
        }}
      />

      {/* ---- content sits above the photo + wash ---- */}
      <Link
        to="/"
        className="relative z-10 flex items-center gap-3"
        aria-label="Back to home"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white shadow-md">
          <img
            src={logo}
            alt="Holy Family Catholic Hospital logo"
            className="h-9 w-9 rounded-full"
          />
        </span>
        <span className="leading-tight">
          <strong className="block font-display text-[15px] font-medium">
            Holy Family Catholic Hospital
          </strong>
          <small className="block text-[12px] text-white/70">
            Telemedicine Platform
          </small>
        </span>
      </Link>

      <div className="relative z-10 mt-10">
        <h2 className="font-display text-[26px] xl:text-[28px] font-medium leading-[1.15]">
          {heading}
        </h2>
        <p className="mt-3 text-[14.5px] leading-relaxed text-white/80 max-w-[30ch]">
          {body}
        </p>

        {points.length > 0 && (
          <div className="mt-7 space-y-3">
            {points.map((pt) => (
              <div
                key={pt}
                className="flex items-start gap-2.5 text-[13.5px] text-white/90"
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px]">
                  ✓
                </span>
                <span>{pt}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <svg
        className="relative z-10 mt-10 w-full h-10 opacity-70"
        viewBox="0 0 400 60"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M0 30 H120 L135 8 L160 50 L180 18 L195 30 H400"
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth="2.5"
        />
      </svg>

      <p className="relative z-10 mt-4 text-[11.5px] leading-relaxed text-white/55">
        Session data is encrypted in transit and erased after each consultation.
      </p>
    </aside>
  );
}
