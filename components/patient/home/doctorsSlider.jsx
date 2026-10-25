import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
// Live public doctor directory (doctorProfiles), shared with the booking
// page's doctor picker.
import { useListedDoctors } from "../../../src/doctorDirectory";
import { useSiteSettings } from "../../../src/siteSettings";
import { DoctorCardSummary } from "../doctorProfileDetails";
import { BookingGlyph } from "./bookingCta";

// Doctor portrait that survives a missing file: if the image 404s (or no
// path is set yet) it falls back to an initials tile, so the slider still
// looks finished while photos are being collected.
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
      <span className="absolute bottom-3 left-3 rounded-full bg-[var(--parchment)]/90 px-3 py-1 text-[14px] font-medium text-[var(--ink2)]">
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
 *
 * `index` is the raw stored position; `safeIndex` is what's actually
 * rendered. When the viewport changes and maxIndex shrinks, safeIndex is
 * clamped during render, so no effect is needed to "fix up" state.
 */
export default function DoctorsSlider() {
  const { doctors, loading, error } = useListedDoctors();
  const { doctorSelectionEnabled } = useSiteSettings().settings;
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
  const safeIndex = Math.min(index, maxIndex);

  const next = useCallback(
    () =>
      setIndex((current) =>
        Math.min(current, maxIndex) >= maxIndex
          ? 0
          : Math.min(current, maxIndex) + 1,
      ),
    [maxIndex],
  );
  const prev = useCallback(
    () =>
      setIndex((current) =>
        Math.min(current, maxIndex) <= 0
          ? maxIndex
          : Math.min(current, maxIndex) - 1,
      ),
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

  // Still reading the list (first visit): placeholder cards, same size as
  // the real ones, so nothing jumps when the doctors arrive.
  if (loading && doctors.length === 0) {
    return (
      <div className="mt-10 sm:mt-12 flex" role="status" aria-label="Loading our doctors">
        {Array.from({ length: perView }).map((_, i) => (
          <div key={i} className="shrink-0 px-2 sm:px-3" style={{ flexBasis: `${100 / perView}%` }}>
            <div className="h-full rounded-3xl border border-[#14213814] bg-white p-3 shadow-[0_18px_40px_-28px_rgba(15,20,17,0.6)]">
              <div className="aspect-[3/4] w-full animate-pulse rounded-2xl bg-[#14213810]" />
              <div className="px-1.5 pb-1 pt-4">
                <div className="h-4 w-3/5 animate-pulse rounded bg-[#14213814]" />
                <div className="mt-3 h-3.5 w-2/5 animate-pulse rounded bg-[#1421380d]" />
                <div className="mt-2 h-3.5 w-4/5 animate-pulse rounded bg-[#1421380d]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (doctors.length === 0) {
    return (
      <p className="mt-8 px-2 sm:px-3 text-[16px] text-[#142138cc]">
        {error
          ? "We couldn't load our doctors just now. Check your internet connection and open this page again."
          : "Our doctors' profiles will appear here soon."}
      </p>
    );
  }
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
          style={{ transform: `translateX(-${safeIndex * (100 / perView)}%)` }}
        >
          {doctors.map((doctor, i) => {
            const visible = i >= safeIndex && i < safeIndex + perView;
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
                    <DoctorCardSummary doctor={doctor} />
                    {/* Sends the patient straight into the booking flow with
                        this doctor pre-selected. Hidden when the admin has
                        switched doctor choice off. */}
                    {doctorSelectionEnabled && (
                      <Link
                        to={`/book?doctor=${doctor.id}`}
                        className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--forest)]/20 px-3.5 py-2 text-[15px] font-medium text-[var(--forest-2)]
                                 transition hover:border-[var(--forest)] hover:bg-[var(--forest)] hover:text-white
                                 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--forest)]"
                      >
                        <BookingGlyph className="shrink-0" />
                        Book this doctor
                      </Link>
                    )}
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
              aria-current={i === safeIndex}
              className={`h-2 rounded-full transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--forest)] ${
                i === safeIndex
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
