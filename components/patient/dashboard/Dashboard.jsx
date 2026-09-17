import { useEffect, useState } from "react";
import { CreditCard, Radio, LogOut, Home as HomeIcon } from "lucide-react";
import { currentPatient } from "./PatientMockdata";
import {
  fetchMyBookings,
  fetchAvailableSlots,
} from "./PatientfirestoreService";
import StatTile from "./PatientStattile";
import BookingCard from "./BookingCard";
import AvailableSlots from "./AvailableSlots";

// ASSUMPTION: adjust this import path to wherever src/assets actually
// sits relative to components/patient/dashboard in your project.
import logo from "../../../src/assets/logo.png";

// ASSUMPTION: Footer lives at components/shared/Footer.jsx. From
// components/patient/dashboard/Dashboard.jsx that's two levels up
// into components/, then into shared/. Adjust if your actual layout
// differs.
import Footer from "../../shared/Footer";

/**
 * Dashboard.jsx
 * Where a patient lands after login. Per the architecture (4.6), there is
 * no "past visits" history in the live data model — once a session is
 * closed its booking/consultation docs are permanently erased, and the
 * only thing kept is an anonymised, non-patient-linked metrics record.
 * See the note above HISTORY_ENABLED below before wiring this up for real.
 *
 * TODO(auth): wire up real sign-out and swap currentPatient for the
 * authenticated user once auth is in place.
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
  const [bookings, setBookings] = useState(null);
  const [slots, setSlots] = useState([]);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);

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
      import("./PatientfirestoreService")
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#5C6B72]">
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

  return (
    <div className="min-h-screen bg-white font-sans text-[#12242C] flex flex-col">
      {/* ASSUMPTION: "static" header = stays pinned to the top of the
          viewport while the page scrolls (sticky), rather than the CSS
          `position: static` default. Adjust if you meant something else. */}
      <header className="sticky top-0 z-20 bg-white border-b border-[#DCE6EC]">
        <div className="mx-auto max-w-4xl px-5 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={logo}
              alt="Holy Family Catholic Hospital"
              className="h-9 w-9 rounded-full shrink-0"
            />
            <span className="text-sm font-medium truncate">
              Hi, {currentPatient.name.split(" ")[0]}
            </span>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            {/* ASSUMPTION: home route is "/" — update if the app uses a
                different path (e.g. "/home"). */}
            <a
              href="/"
              className="flex items-center gap-1.5 text-xs text-[#5C6B72] hover:text-[#12242C]"
            >
              <HomeIcon size={14} strokeWidth={1.75} />
              Home
            </a>
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-[#5C6B72] hover:text-[#12242C]"
            >
              <LogOut size={14} strokeWidth={1.75} />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 sm:px-8 py-6 sm:py-8 space-y-8 flex-1 w-full">
        <div className="grid grid-cols-3 rounded-md border border-[#DCE6EC] overflow-hidden">
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
              <p className="text-sm text-[#5C6B72]">
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
                onJoined={(id, result) =>
                  updateBooking(id, { callStartedAt: result.callStartedAt })
                }
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
            <p className="mt-1 text-xs text-[#5C6B72]">
              Past, closed consultations. Session details are removed once a
              consultation ends, so this list only shows what your hospital's
              current history feature chooses to keep.
            </p>

            <div className="mt-3 space-y-2.5">
              {history === null && (
                <p className="text-sm text-[#5C6B72]">Loading history…</p>
              )}
              {history?.length === 0 && (
                <p className="text-sm text-[#5C6B72]">
                  No past consultations yet.
                </p>
              )}
              {history?.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border border-[#DCE6EC] px-4 py-3.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-[#12242C]">
                      {item.type}
                    </span>
                    <span className="text-xs text-[#5C6B72]">
                      {item.mode === "online" ? "Online" : "In person"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[#5C6B72]">
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

      <Footer />
    </div>
  );
}
