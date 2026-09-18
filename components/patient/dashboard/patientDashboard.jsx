import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreditCard, Radio, LogOut, Home as HomeIcon } from "lucide-react";
import { currentPatient } from "./patientMockData";
import {
  fetchMyBookings,
  fetchAvailableSlots,
} from "./patientFirestoreService";
import StatTile from "./patientStatTile";
import BookingCard from "./patientBookingCard";
import AvailableSlots from "./patientAvailableSlots";
// NEW: shared Jitsi video call modal (same component the doctor side uses)
import VideoCallModal from "../../video/videoCallModal";
// Fixed, auto-slideshow brand panel — see BrandAside.jsx.
import BrandAside from "../../shared/brandAside";

// ASSUMPTION: adjust this import path to wherever src/assets actually
// sits relative to components/patient/dashboard in your project.
import logo from "../../../src/assets/logo.png";

// ASSUMPTION: Footer lives at components/shared/Footer.jsx. From
// components/patient/dashboard/Dashboard.jsx that's two levels up
// into components/, then into shared/. Adjust if your actual layout
// differs.
import Footer from "../../shared/footer";

/**
 * Dashboard.jsx
 * Where a patient lands after login. Per the architecture (4.6), there is
 * no "past visits" history in the live data model — once a session is
 * closed its booking/consultation docs are permanently erased, and the
 * only thing kept is an anonymised, non-patient-linked metrics record.
 * See the note above HISTORY_ENABLED below before wiring this up for real.
 *
 * TODO(auth): swap currentPatient and handleSignOut's local cleanup for
 * whatever the real auth provider ends up being (Firebase Auth signOut(),
 * clearing its session cookie, etc.) — see handleSignOut below.
 *
 * LAYOUT: BrandAside is `position: fixed` and this file's own <header>
 * below is `sticky top-0` inside a column that's the only thing that
 * scrolls — the aside and header both stay in place while `<main>`
 * scrolls beneath them. The right-hand column is pushed clear of the
 * fixed aside with `lg:ml-[340px] xl:ml-[380px]`, matching the aside's
 * width exactly (see BrandAside.jsx).
 *
 * Both header actions (Home, Sign out) now always show their text label
 * alongside the icon, at every screen size — an icon alone isn't
 * self-explanatory to everyone, so the label is never hidden.
 *
 * PALETTE: this file now uses only three colors — brand orange
 * (#F88535), brand blue (#0095D9), and white — for every accent,
 * gradient, button and status indicator (the "live" dot included, which
 * was red before). Body text and hairline borders still use plain black
 * at reduced opacity for readability, since that's a neutral rather than
 * a fourth brand color.
 */

// ASSUMPTION / FLAG: there is currently no per-patient consultation
// history to fetch under the architecture as documented (section 4.6
// erases booking/consultation docs on Close Session, and the metrics
// record that survives is intentionally NOT linked to a patient).
// Section 10 (Future Scaling Notes) allows for a dedicated history
// collection to be added later without touching booking/payment logic
// — but that's a backend + data-model decision, not something this
// component can safely assume. This flag renders the section only if
// fetchConsultationHistory exists and returns data, so the dashboard
// keeps working today and picks up history automatically once/if a
// real history collection and endpoint exist.
const HISTORY_ENABLED = true;

export default function Dashboard() {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState(null);
  const [slots, setSlots] = useState([]);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  // NEW: which booking's call is currently open full-screen, if any
  const [activeCallBookingId, setActiveCallBookingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const tasks = [fetchMyBookings(currentPatient.uid), fetchAvailableSlots()];

    Promise.all(tasks).then(([b, s]) => {
      if (cancelled) return;
      setBookings(b);
      setSlots(s);
      setLoading(false);
    });

    if (HISTORY_ENABLED) {
      // ASSUMPTION: fetchConsultationHistory does not exist in the
      // firestoreService shown yet — add it once the backend actually
      // has somewhere to read history from (see flag above).
      import("./patientFirestoreService")
        .then((mod) =>
          mod.fetchConsultationHistory
            ? mod.fetchConsultationHistory(currentPatient.uid)
            : Promise.resolve([]),
        )
        .then((h) => {
          if (!cancelled) setHistory(h);
        })
        .catch(() => {
          if (!cancelled) setHistory([]);
        });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  function updateBooking(bookingId, patch) {
    setBookings((prev) =>
      prev.map((b) => (b.bookingId === bookingId ? { ...b, ...patch } : b)),
    );
  }

  function addBooking(newBooking) {
    setBookings((prev) => [newBooking, ...(prev ?? [])]);
  }

  // NEW: fires when BookingCard's own "Join call" flow succeeds (this is
  // the existing onJoined callback — the patient has already entered
  // their consultation ID inside BookingCard per architecture section
  // 4.5, and BookingCard's join function has resolved with a
  // callStartedAt). We just also open the full-screen call here.
  function handleJoined(bookingId, result) {
    updateBooking(bookingId, { callStartedAt: result.callStartedAt });
    setActiveCallBookingId(bookingId);
  }

  // NEW: makes the "Sign out" button actually do something. There's no
  // real auth wired up yet (see the TODO(auth) note above), so this does
  // the two things any real sign-out needs to end in: clear whatever
  // local session state exists, and leave the authenticated area. Swap
  // the try block for your real auth SDK's sign-out call — e.g.
  //   await getAuth().signOut();
  // — once accounts exist, and this function shape won't need to change.
  async function handleSignOut() {
    try {
      window.localStorage?.removeItem("hfh_session");
      window.sessionStorage?.removeItem("hfh_session");
    } catch {
      // Storage can be unavailable (e.g. private browsing) — sign-out
      // should still proceed to redirect either way.
    }
    navigate("/signin");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-black/60">
        Loading your bookings…
      </div>
    );
  }

  const awaitingPayment = bookings.filter(
    (b) => b.state === "awaiting_payment",
  ).length;
  const pendingVerification = bookings.filter(
    (b) => b.state === "pending_verification",
  ).length;
  const liveNow = bookings.some((b) => Boolean(b.callStartedAt));

  // NEW: look up the full booking behind the active call, so we know
  // which consultationId to hand to Jitsi.
  const activeCallBooking = bookings.find(
    (b) => b.bookingId === activeCallBookingId,
  );

  // NEW: bookings whose call has already been started at least once.
  // Once callStartedAt is set, BookingCard's own "Join" button may no
  // longer be the way back in (that's the button meant for the *first*
  // join, where the patient enters the consultation ID) — so give these
  // a standing "Rejoin call" action straight from the dashboard, no
  // re-entry of the consultation ID needed since it already joined once.
  const liveBookings = bookings.filter(
    (b) => b.mode === "online" && Boolean(b.callStartedAt),
  );

  const firstName = currentPatient.name.split(" ")[0];

  return (
    <div className="min-h-screen bg-white font-sans text-black">
      {/* Fixed, auto-slideshow brand panel. */}
      <BrandAside
        heading="Your care, one place."
        body="Track bookings, confirm payments, and join your video consultation without ever visiting the hospital in person."
        points={[
          "Confirmed by real hospital staff",
          "Session details erased after every visit",
          "Same doctors as our hospital",
        ]}
      />

      {/* Right-hand column: pushed clear of the fixed aside, and the only
          part of the page that scrolls — see the LAYOUT note above. */}
      <div className="lg:ml-[340px] xl:ml-[380px] min-h-screen flex flex-col">
        <header
          className="sticky top-0 z-20 text-white shadow-[0_10px_30px_-20px_rgba(0,0,0,0.35)]"
          style={{
            background: "linear-gradient(100deg, #F88535 0%, #0095D9 100%)",
          }}
        >
          <div className="mx-auto max-w-4xl px-5 sm:px-8 h-[68px] flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src={logo}
                alt="Holy Family Catholic Hospital"
                className="h-10 w-10 rounded-full shrink-0 ring-2 ring-white/40"
              />
              <span className="min-w-0 leading-tight">
                <span className="block text-[11px] uppercase tracking-wide text-white/70 sm:hidden">
                  Holy Family Catholic Hospital
                </span>
                <span className="hidden sm:block text-[12px] text-white/70">
                  Holy Family Catholic Hospital
                </span>
                <span className="block text-[15px] font-medium truncate">
                  Hi, {firstName}
                </span>
              </span>
            </div>
            {/* Both actions always show their label next to the icon — an
                icon on its own isn't clear to everyone, at any width. */}
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <a
                href="/"
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15 transition"
              >
                <HomeIcon size={14} strokeWidth={1.75} />
                <span>Home</span>
              </a>
              <button
                type="button"
                onClick={handleSignOut}
                className="flex items-center gap-1.5 rounded-full border border-white/40 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15 transition"
              >
                <LogOut size={14} strokeWidth={1.75} />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-4xl px-5 sm:px-8 py-6 sm:py-8 space-y-8 flex-1 w-full">
          <div className="grid grid-cols-3 rounded-md border border-black/10 overflow-hidden">
            <StatTile
              label="Awaiting payment"
              value={awaitingPayment}
              icon={CreditCard}
            />
            <StatTile
              label="Pending verification"
              value={pendingVerification}
              icon={Radio}
            />
            <StatTile
              label="Live now"
              value={liveNow ? "Yes" : "—"}
              icon={Radio}
              tone={liveNow ? "live" : "default"}
            />
          </div>

          {liveBookings.length > 0 && (
            <section className="space-y-2.5">
              <h2 className="text-base font-medium">Live consultation</h2>
              {liveBookings.map((booking) => (
                <div
                  key={booking.bookingId}
                  className="flex items-center justify-between gap-3 rounded-md border border-black/10 bg-[#F88535]/5 px-4 py-3.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[#F88535]" />
                    <span className="text-sm text-black">
                      {booking.type ?? "Consultation"} · in progress
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveCallBookingId(booking.bookingId)}
                    className="rounded-sm px-3 py-1.5 text-xs font-medium text-white shrink-0"
                    style={{ backgroundColor: "#0095D9" }}
                  >
                    Rejoin call
                  </button>
                </div>
              ))}
            </section>
          )}

          <section>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-medium">Your bookings</h2>
              <a
                href="/book"
                className="rounded-sm px-3 py-1.5 text-xs font-medium text-white shrink-0"
                style={{ backgroundColor: "#0095D9" }}
              >
                Book a consultation
              </a>
            </div>

            <div className="mt-3 space-y-2.5">
              {bookings.length === 0 && (
                <p className="text-sm text-black/60">
                  You don't have any bookings yet.
                </p>
              )}
              {bookings.map((booking) => (
                <BookingCard
                  key={booking.bookingId}
                  booking={booking}
                  onPaid={(id, result) =>
                    updateBooking(id, { state: result.state })
                  }
                  onRescheduled={() => {}}
                  onJoined={handleJoined}
                />
              ))}
            </div>
          </section>

          <section>
            <AvailableSlots slots={slots} onClaimed={addBooking} />
          </section>

          {HISTORY_ENABLED && (
            <section>
              <h2 className="text-base font-medium">Consultation history</h2>
              <p className="mt-1 text-xs text-black/60">
                Past, closed consultations. Session details are removed once a
                consultation ends, so this list only shows what your hospital's
                current history feature chooses to keep.
              </p>

              <div className="mt-3 space-y-2.5">
                {history === null && (
                  <p className="text-sm text-black/60">Loading history…</p>
                )}
                {history?.length === 0 && (
                  <p className="text-sm text-black/60">
                    No past consultations yet.
                  </p>
                )}
                {history?.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-md border border-black/10 px-4 py-3.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-black">
                        {item.type}
                      </span>
                      <span className="text-xs text-black/60">
                        {item.mode === "online" ? "Online" : "In person"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-black/60">
                      {item.date}
                      {item.department && <> · {item.department}</>}
                      {item.outcome && <> · {item.outcome}</>}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>

        {/* NEW: full-screen video call, shown whenever a call is active */}
        {activeCallBooking && (
          <VideoCallModal
            consultationId={activeCallBooking.consultationId}
            role="patient"
            onClose={() => setActiveCallBookingId(null)}
          />
        )}

        <Footer />
      </div>
    </div>
  );
}
