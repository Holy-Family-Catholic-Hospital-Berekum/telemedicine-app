import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TYPE_LABELS, MODE_LABELS, formatDateTime } from "../../../src/constants";
import { slotBookingPath } from "../dashboard/patientUtils";

/**
 * OpenSlots: appointment times admins have opened, listed under "Meet your
 * doctors". Firestore rules make open slots public (doctor, type, mode and
 * time only). "Book this time" opens /book with the slot pre-filled; a
 * visitor who isn't signed in is sent to sign in first. Hidden when there
 * are none.
 */
const SLOTS_SHOWN = 6;

export default function OpenSlots() {
  const [slots, setSlots] = useState([]);
  const [showAll, setShowAll] = useState(false);

  // Loaded once (Firebase on demand, after the page shows), and again when
  // the visitor comes back to the page after a minute or more.
  useEffect(() => {
    let active = true;
    let lastLoaded = 0;
    const load = () => {
      lastLoaded = Date.now();
      import("../dashboard/patientFirestoreService")
        .then((m) => m.fetchAvailableSlots())
        .then((data) => active && setSlots(data ?? []))
        .catch(() => {}); // the section just stays hidden
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoaded > 60 * 1000) load();
    };
    load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (slots.length === 0) return null;
  const shown = showAll ? slots : slots.slice(0, SLOTS_SHOWN);

  return (
    <section id="open-slots" className="pb-16 sm:pb-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <h2 className="font-display text-[26px] sm:text-[30px] font-medium text-[var(--ink2)]">
          Open appointment times
        </h2>
        <p className="mt-3 max-w-xl text-[17px] text-[#142138]">
          Pick a time that suits you and book it straight away.
        </p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((slot) => {
            return (
              <li
                key={slot.slotId}
                className="flex flex-col justify-between gap-4 rounded-2xl border border-black/10 bg-white p-5 shadow-[0_8px_24px_-18px_rgba(0,0,0,0.35)]"
              >
                <div>
                  <p className="text-[18px] font-semibold text-[#142138]">
                    {formatDateTime(slot.startAt)}
                  </p>
                  <p className="mt-1 text-[17px] text-[#142138]">
                    {slot.doctorName || "Hospital doctor"}
                  </p>
                  <p className="mt-1 text-[16px] text-[#142138cc]">
                    {TYPE_LABELS[slot.type] ?? slot.type} ·{" "}
                    {MODE_LABELS[slot.mode] ?? slot.mode}
                  </p>
                </div>
                <Link
                  to={slotBookingPath(slot)}
                  className="inline-flex items-center justify-center rounded-full bg-[#0095D9] px-5 py-3 text-[16px] font-semibold text-white transition hover:bg-[#0083c0]"
                >
                  Book this time
                </Link>
              </li>
            );
          })}
        </ul>
        {slots.length > SLOTS_SHOWN && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-6 text-[16px] font-medium text-[#0095D9] underline underline-offset-4"
          >
            {showAll ? "Show fewer times" : `Show all ${slots.length} times`}
          </button>
        )}
      </div>
    </section>
  );
}
