import { HOSPITAL_PHONE_TEL } from "../../shared/contact";
import BookingCta from "./bookingCta";

/**
 * The home page's first screen.
 *
 * LAYOUT
 * - Phones / tablets: photo on top (full-bleed), fading into white at its
 *   bottom edge. The copy is pulled up over that fade, so photo + headline +
 *   CTA all sit in the first screen.
 * - Desktop (lg+): photo is full-bleed to the right edge of the screen, about
 *   62% wide, fading into the copy on its left. No boxed frame, no hard edges.
 *
 * MOTION (all switched off for prefers-reduced-motion)
 * - slow "breathing" zoom on the photo
 * - gradient that slides through "at your doorstep."
 * - drifting colour glows, shimmer sweep on the CTA
 */
export default function HeroSection({ heroImage }) {
  return (
    <section className="hero relative isolate overflow-hidden bg-white">
      <style>{`
        @keyframes heroRise {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes heroPhotoIn {
          from { opacity: 0; transform: scale(1.06); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes heroBreathe {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.045); }
        }
        @keyframes heroGradient {
          0%   { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
        @keyframes heroDrift {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
          50%      { transform: translate3d(26px, -20px, 0) scale(1.08); }
        }
        @keyframes heroShimmer {
          0%, 55% { transform: translateX(-130%) skewX(-18deg); }
          100%    { transform: translateX(330%) skewX(-18deg); }
        }

        .hero-rise    { animation: heroRise .8s cubic-bezier(.2,.8,.2,1) both; }
        .hero-photo   { animation: heroPhotoIn 1.1s ease-out both; }
        .hero-breathe { animation: heroBreathe 18s ease-in-out infinite; }
        .hero-drift   { animation: heroDrift 14s ease-in-out infinite; }
        .hero-shimmer { animation: heroShimmer 4.5s ease-in-out infinite; }
        .hero-gradient-text {
          background-image: linear-gradient(100deg, #0095D9 0%, #0095D9 30%, #2CC5C0 48%, #F88535 66%, #0095D9 84%, #0095D9 100%);
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          -webkit-text-fill-color: transparent;
          animation: heroGradient 7s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .hero-rise, .hero-photo, .hero-breathe, .hero-drift,
          .hero-shimmer, .hero-gradient-text { animation: none !important; }
          .hero-gradient-text { background-position: 0% 50%; }
        }
      `}</style>

      {/* Colour glows: sit behind everything, drift slowly. */}
      <div
        aria-hidden="true"
        className="hero-drift pointer-events-none absolute -right-24 -top-32 -z-10 h-[420px] w-[420px] rounded-full blur-3xl sm:h-[560px] sm:w-[560px]"
        style={{
          background:
            "radial-gradient(circle, rgba(0,149,217,0.22) 0%, rgba(0,149,217,0.07) 45%, transparent 72%)",
        }}
      />
      <div
        aria-hidden="true"
        className="hero-drift pointer-events-none absolute -bottom-40 -left-24 -z-10 h-[380px] w-[380px] rounded-full blur-3xl sm:h-[520px] sm:w-[520px]"
        style={{
          animationDelay: "-6s",
          background:
            "radial-gradient(circle, rgba(248,133,53,0.20) 0%, rgba(248,133,53,0.06) 48%, transparent 72%)",
        }}
      />

      {/* ---------- Photo ----------
          Mobile: normal block on top, height tied to the screen so the CTA
          stays in view. lg+: absolutely positioned, full-bleed to the right. */}
      <div
        className="hero-photo relative h-[44svh] min-h-[300px] max-h-[520px]
                   lg:absolute lg:inset-y-0 lg:right-0 lg:h-auto lg:max-h-none lg:min-h-0 lg:w-[62%]"
      >
        <div className="absolute inset-0 overflow-hidden">
          <img
            src={heroImage}
            alt="A doctor at Holy Family Catholic Hospital speaking warmly with a patient"
            className="hero-breathe h-full w-full object-cover object-[72%_22%] lg:object-[64%_center]"
            fetchPriority="high"
          />
        </div>

        {/* Blend layers. Plain white gradients on a white section: the photo
            melts into the page on every side that meets content. */}
        {/* Mobile: bottom fade, plus a light top fade under the header. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 lg:hidden"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,.75) 0%, rgba(255,255,255,0) 14%, rgba(255,255,255,0) 52%, rgba(255,255,255,.9) 84%, #FFFFFF 100%)",
          }}
        />
        {/* Mobile: soften the left/right edges so no hard rectangle shows. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 lg:hidden"
          style={{
            background:
              "linear-gradient(90deg, rgba(255,255,255,.85) 0%, rgba(255,255,255,0) 9%, rgba(255,255,255,0) 91%, rgba(255,255,255,.85) 100%)",
          }}
        />
        {/* Desktop: fade into the copy on the left. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 hidden lg:block"
          style={{
            background:
              "linear-gradient(90deg, #FFFFFF 0%, rgba(255,255,255,.92) 9%, rgba(255,255,255,.55) 22%, rgba(255,255,255,0) 46%)",
          }}
        />
        {/* Desktop: top + bottom fades so the photo never has a hard edge. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 hidden lg:block"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,.85) 0%, rgba(255,255,255,0) 16%, rgba(255,255,255,0) 80%, #FFFFFF 100%)",
          }}
        />

        {/* Glass chip over the photo (desktop only). Only facts the page
            already states. */}
        <div
          className="absolute bottom-[8%] right-[5%] hidden items-center gap-2.5 rounded-full border border-white/70 bg-white/85 px-4 py-2.5 text-[14px] font-semibold text-[#142138] shadow-[0_18px_45px_-24px_rgba(20,33,56,0.4)] backdrop-blur-md lg:flex"
        >
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

      {/* ---------- Copy ----------
          Negative top margin pulls the text up over the photo's fade on
          phones; on lg+ it is vertically centred against the full-bleed photo. */}
      <div className="relative z-10 mx-auto max-w-7xl px-5 pb-12 sm:px-8 lg:flex lg:min-h-[calc(100svh-80px)] lg:items-center lg:px-10 lg:py-16">
        <div className="-mt-24 text-center sm:-mt-32 lg:mt-0 lg:max-w-[560px] lg:text-left xl:max-w-[600px]">
          <div
            className="hero-rise inline-flex items-center gap-2 rounded-full border border-[#0095D9]/15 bg-white/80 px-3.5 py-2 text-[14px] font-semibold text-[#0079B2] shadow-[0_10px_30px_-22px_rgba(0,149,217,0.6)] backdrop-blur-sm"
            style={{ animationDelay: "0.05s" }}
          >
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

          <h1
            className="hero-rise mt-5 font-display text-[clamp(38px,9.4vw,74px)] font-medium leading-[1.03] tracking-[-0.045em] text-[var(--ink2)] sm:mt-6 lg:text-[clamp(44px,4.4vw,66px)]"
            style={{ animationDelay: "0.15s" }}
          >
            Quality healthcare{" "}
            <span className="relative inline-block">
              <span className="hero-gradient-text">at your doorstep.</span>
              <span
                aria-hidden="true"
                className="absolute -bottom-1.5 left-0 h-[5px] w-1/2 rounded-full bg-gradient-to-r from-[#F88535] to-[#F88535]/0 sm:-bottom-2"
              />
            </span>
          </h1>

          <p
            className="hero-rise mx-auto mt-6 max-w-md text-[clamp(15px,2vw,18px)] leading-[1.7] text-[#142138C7] lg:mx-0 lg:max-w-lg"
            style={{ animationDelay: "0.25s" }}
          >
            See a hospital doctor by video call on your phone, or book a
                visit at the hospital. Pay with mobile money.
          </p>

          <div
            className="hero-rise mt-7 flex flex-col items-stretch gap-3.5 sm:mt-8 sm:flex-row sm:items-center sm:justify-center lg:justify-start"
            style={{ animationDelay: "0.35s" }}
          >
            {/* Primary CTA with a shimmer sweep. Wrapper clips the light. */}
            <span className="relative inline-flex overflow-hidden rounded-full">
              <BookingCta
                size="lg"
                variant="gold"
                className="w-full shadow-[0_18px_38px_-16px_rgba(248,133,53,0.65)] hover:-translate-y-0.5 sm:w-auto"
              />
              <span
                aria-hidden="true"
                className="hero-shimmer pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-white/45 to-transparent"
              />
            </span>
            <a
              href={HOSPITAL_PHONE_TEL}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-[#14213820] bg-white/90 px-5 py-3.5 text-[16px] font-semibold text-[var(--ink2)] shadow-[0_12px_30px_-24px_rgba(20,33,56,0.45)] backdrop-blur transition hover:-translate-y-0.5 hover:border-[#0095D9]/40 hover:text-[#0095D9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0095D9]"
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

          <ul
            className="hero-rise mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2.5 lg:justify-start"
            style={{ animationDelay: "0.45s" }}
          >
            {["Same doctors as our hospital"].map((item) => (
              <li
                key={item}
                className="flex items-center gap-2 text-[15px] font-medium text-[#142138B0]"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0095D9]/[0.1] text-[#0095D9]">
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
      </div>
    </section>
  );
}
