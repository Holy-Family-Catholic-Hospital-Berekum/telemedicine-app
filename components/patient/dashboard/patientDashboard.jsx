import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock3, Radio, LogOut, Home as HomeIcon } from "lucide-react";
import { useAuth } from "../../../src/context/authContext.jsx";
import HealthcarePreloader from "../../../src/components/common/healthcarePreloader.jsx";

import { callableMessage } from "../../../src/constants";
import {
  joinVideoCall,
  fetchMyBookings,
  fetchAvailableSlots,
  fetchConsultationHistory,
} from "./patientFirestoreService";

import StatTile from "./patientStatTile";
import BookingCard from "./patientBookingCard";
import AvailableSlots from "./patientAvailableSlots";
import ConsultationHistory from "./consultationHistory";

import VideoCallModal from "../../video/videoCallModal";
import BrandAside from "../../shared/brandAside";
import logo from "../../../src/assets/logo.png";
import Footer from "../../shared/footer";

export default function Dashboard() {
  const navigate = useNavigate();
  // The route is wrapped in ProtectedRoute (patient, verified email), so
  // `user` is always a signed-in patient here.
  const { user, profile, signOutUser } = useAuth();

  const [bookings, setBookings] = useState(null);
  const [slots, setSlots] = useState([]);
  const [history, setHistory] = useState(null);
  // { bookingId, patientSeq } for the call that's open, if any.
  const [activeCall, setActiveCall] = useState(null);
  const [rejoinError, setRejoinError] = useState(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    Promise.all([
      fetchMyBookings(user.uid),
      fetchAvailableSlots(),
      fetchConsultationHistory(user.uid),
    ])
      .then(([bookingData, slotData, historyData]) => {
        if (cancelled) return;
        setBookings(bookingData ?? []);
        setSlots(slotData ?? []);
        setHistory(historyData ?? []);
      })
      .catch((error) => {
        console.error("Failed to load dashboard:", error);
        if (cancelled) return;
        setBookings([]);
        setSlots([]);
        setHistory([]);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);


  // Rejoin goes through startVideoCall again: the server re-checks access
  // and gives this attempt a new patientSeq so the doctor re-offers.
  async function handleRejoinCall(booking) {
    if (!booking?.consultationId) return;
    setRejoinError(null);
    try {
      const result = await joinVideoCall({
        booking,
        enteredConsultationId: booking.consultationId,
      });
      handleJoined(booking.bookingId, result);
    } catch (err) {
      setRejoinError(callableMessage(err, "We couldn't reconnect you. Try again."));
    }
  }

  function reloadBookings() {
    fetchMyBookings(user.uid)
      .then((data) => setBookings(data ?? []))
      .catch((error) => console.error("Failed to reload bookings:", error));
  }

  function updateBooking(bookingId, patch) {
    setBookings((prev) =>
      (prev ?? []).map((booking) =>
        booking.bookingId === bookingId ? { ...booking, ...patch } : booking,
      ),
    );
  }

  function handleJoined(bookingId, result) {
    updateBooking(bookingId, { callStartedAt: result.callStartedAt });
    setActiveCall({ bookingId, patientSeq: result.patientSeq ?? 0 });
  }

  async function handleSignOut() {
    await signOutUser();
    navigate("/signin");
  }

  if (user && bookings === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <HealthcarePreloader label="Loading your bookings..." size={48} />
      </div>
    );
  }

  if (!user) return null;

  const safeBookings = bookings ?? [];

  const awaitingAssignment = safeBookings.filter(
    (booking) => booking.state === "pending_assignment",
  ).length;

  const liveNow = safeBookings.some((booking) =>
    Boolean(booking.callStartedAt),
  );

  const activeCallBooking = safeBookings.find(
    (booking) => booking.bookingId === activeCall?.bookingId,
  );

  const liveBookings = safeBookings.filter(
    (booking) => booking.mode === "online" && Boolean(booking.callStartedAt),
  );

  const firstName = (profile?.name || user.displayName || "there").split(" ")[0];

  return (
    <div className="min-h-screen bg-white font-sans text-black">
      <BrandAside
        heading="Your care, one place."
        body="Track bookings, and join your video consultation without ever visiting the hospital in person."
        points={[
          "Booking details deleted when your visit closes",
          "Same doctors as our hospital",
        ]}
      />

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

        <main className="mx-auto max-w-4xl px-5 sm:px-8 py-6 sm:py-8 space-y-8 min-h-[calc(100dvh-68px+5rem)] w-full">
          <div className="grid grid-cols-2 rounded-md border border-black/10 overflow-hidden">
            <StatTile
              label="Awaiting assignment"
              value={awaitingAssignment}
              icon={Clock3}
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
              {rejoinError && <p className="text-xs text-[#B23A3A]">{rejoinError}</p>}
              {liveBookings.map((booking) => (
                <div
                  key={booking.bookingId}
                  className="flex items-center justify-between gap-3 rounded-md border border-black/10 bg-[#F88535]/5 px-4 py-3.5"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[#F88535]" />
                    <span className="text-sm text-black truncate">
                      {booking.type ?? "Consultation"} · in progress
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRejoinCall(booking)}
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
              {safeBookings.length === 0 && (
                <p className="text-sm text-black/60">
                  You don't have any bookings yet.
                </p>
              )}
              {safeBookings.map((booking) => (
                <BookingCard
                  key={booking.bookingId}
                  booking={booking}
                  onRescheduled={() => {}}
                  onJoined={handleJoined}
                  onRejoinCall={handleRejoinCall}
                  onPaymentConfirmed={reloadBookings}
                />
              ))}
            </div>
          </section>

          <section>
            <AvailableSlots slots={slots} />
          </section>

          <section>
            <h2 className="text-base font-medium">Consultation history</h2>
            <p className="mt-1 text-xs text-black/60">
              Past, closed consultations: doctor, times and amount paid. The
              personal details you gave when booking are deleted once a
              consultation closes.
            </p>
            <div className="mt-3">
              {history === null ? (
                <p className="text-sm text-black/60">Loading history…</p>
              ) : (
                <ConsultationHistory consultations={history} />
              )}
            </div>
          </section>
        </main>

        {activeCallBooking && (
          <VideoCallModal
            key={`${activeCall.bookingId}-${activeCall.patientSeq}`}
            consultationId={activeCallBooking.consultationId}
            role="patient"
            patientSeq={activeCall.patientSeq}
            onClose={() => setActiveCall(null)}
          />
        )}

        <Footer />
      </div>
    </div>
  );
}
