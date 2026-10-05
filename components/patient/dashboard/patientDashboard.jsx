import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LogOut,
  Home as HomeIcon,
  CalendarCheck,
  Hourglass,
  CreditCard,
  CalendarDays,
  Settings as SettingsIcon,
  CalendarPlus,
} from "lucide-react";
import { useAuth } from "../../../src/context/authContext.jsx";
import HealthcarePreloader from "../../../src/components/common/healthcarePreloader.jsx";

import { callableMessage } from "../../../src/constants";
import { CURRENT_CALL_CONSENT } from "../../../src/consentText";
import CallConsentDialog from "./callConsentDialog";
import {
  joinVideoCall,
  fetchMyBookings,
  fetchAvailableSlots,
  fetchConsultationHistory,
  fetchMyRefundRequests,
} from "./patientFirestoreService";

import { getCallWindow } from "./patientUtils";
import BookingCard from "./patientBookingCard";
import AvailableSlots from "./patientAvailableSlots";
import ConsultationHistory from "./consultationHistory";
import PatientSettings from "./patientSettings";

import VideoCallModal from "../../video/videoCallModal";
import BrandAside from "../../shared/brandAside";
import logo from "../../../src/assets/logo.png";
import Footer from "../../shared/footer";

export default function Dashboard() {
  const navigate = useNavigate();
  // The route is wrapped in ProtectedRoute (patient, verified email), so
  // `user` is always a signed-in patient here.
  const { user, profile, signOutUser } = useAuth();

  const [tab, setTab] = useState("appointments"); // "appointments" | "settings"
  const [bookings, setBookings] = useState(null);
  const [slots, setSlots] = useState([]);
  const [history, setHistory] = useState(null);
  const [refunds, setRefunds] = useState({}); // consultationId -> request
  // { bookingId, patientSeq } for the call that's open, if any.
  const [activeCall, setActiveCall] = useState(null);
  const [rejoinError, setRejoinError] = useState(null);
  const [consentFor, setConsentFor] = useState(null); // booking awaiting call consent
  const [consentBusy, setConsentBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    Promise.all([
      fetchMyBookings(user.uid),
      fetchAvailableSlots(),
      fetchConsultationHistory(user.uid),
      fetchMyRefundRequests(user.uid).catch(() => ({})),
    ])
      .then(([bookingData, slotData, historyData, refundData]) => {
        if (cancelled) return;
        setRefunds(refundData ?? {});
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
  async function handleRejoinCall(booking, callConsentVersion) {
    if (!booking?.consultationId) return;
    setRejoinError(null);
    setConsentBusy(true);
    try {
      const result = await joinVideoCall({
        booking,
        callConsentVersion,
      });
      setConsentFor(null);
      handleJoined(booking.bookingId, result);
    } catch (err) {
      if (err?.details?.reason === "call_consent_required") {
        setConsentFor(booking); // consent wasn't recorded yet: ask now
      } else {
        setConsentFor(null);
        setRejoinError(callableMessage(err, "We couldn't reconnect you. Try again."));
      }
    } finally {
      setConsentBusy(false);
    }
  }

  function reloadRefunds() {
    fetchMyRefundRequests(user.uid)
      .then((data) => setRefunds(data ?? {}))
      .catch(() => {});
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
    updateBooking(bookingId, {
      callStartedAt: result.callStartedAt,
      patientJoinedAt: new Date(),
      state: "in_progress",
      callConsentId: "recorded",
    });
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

  // Bookings grouped by where they are, most important first.
  const sortByTime = (a, b) =>
    (a.scheduledTime?.getTime?.() ?? 0) - (b.scheduledTime?.getTime?.() ?? 0);
  const groups = [
    {
      key: "scheduled",
      title: "Scheduled appointments",
      help: "Your appointments with a doctor and a time. Join video calls from here.",
      icon: CalendarCheck,
      items: safeBookings
        .filter((b) => b.state === "scheduled" || b.state === "in_progress")
        .sort(sortByTime),
    },
    {
      key: "waiting",
      title: "Waiting to be scheduled",
      help: "Paid. We're choosing your doctor and time, and will email you when it's set.",
      icon: Hourglass,
      items: safeBookings.filter((b) => b.state === "pending_assignment"),
    },
    {
      key: "unconfirmed",
      title: "Payment not confirmed",
      help: "We haven't received confirmation of these payments yet. Open one to check it. Unpaid bookings are removed after 24 hours.",
      icon: CreditCard,
      items: safeBookings.filter((b) => b.state === "awaiting_payment"),
    },
  ].filter((g) => g.items.length > 0);

  const activeCallBooking = safeBookings.find(
    (booking) => booking.bookingId === activeCall?.bookingId,
  );

  // Calls the patient has been in: one click to go back in.
  const liveBookings = safeBookings.filter(
    (booking) =>
      booking.mode === "online" &&
      Boolean(booking.patientJoinedAt) &&
      !getCallWindow(booking.scheduledTime).closed,
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
          {/* Phones: greeting first (truncates), hospital name on its own
              smaller line, icon-only buttons with 44px tap targets. Labels
              appear from the sm breakpoint up. */}
          <div className="mx-auto flex h-16 max-w-4xl items-center justify-between gap-2 px-4 sm:h-[68px] sm:gap-3 sm:px-8">
            <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
              <img
                src={logo}
                alt=""
                className="h-9 w-9 shrink-0 rounded-full ring-2 ring-white/40 sm:h-10 sm:w-10"
              />
              <div className="min-w-0 leading-tight">
                <p className="truncate text-[17px] font-semibold">Hi, {firstName}</p>
                <p className="truncate text-[13px] text-white/90 sm:text-[14px]">
                  Holy Family Catholic Hospital
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <a
                href="/"
                aria-label="Home"
                title="Home"
                className="flex h-11 w-11 items-center justify-center gap-1.5 rounded-full text-sm font-medium text-white transition hover:bg-white/15 sm:h-auto sm:w-auto sm:px-3 sm:py-2"
              >
                <HomeIcon size={20} strokeWidth={1.9} className="sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Home</span>
              </a>
              <button
                type="button"
                onClick={handleSignOut}
                aria-label="Sign out"
                title="Sign out"
                className="flex h-11 w-11 items-center justify-center gap-1.5 rounded-full text-sm font-medium text-white transition hover:bg-white/15 sm:h-auto sm:w-auto sm:border sm:border-white/50 sm:px-3 sm:py-2"
              >
                <LogOut size={20} strokeWidth={1.9} className="sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-4xl px-5 sm:px-8 py-6 sm:py-8 min-h-[calc(100dvh-64px+5rem)] w-full">
          {/* Two big, plain tabs. */}
          <nav className="grid grid-cols-2 gap-2 rounded-xl bg-[#F1F5F8] p-1.5" aria-label="Dashboard">
            {[
              { id: "appointments", label: "My appointments", icon: CalendarDays },
              { id: "settings", label: "Settings", icon: SettingsIcon },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-base font-semibold transition ${
                  tab === t.id
                    ? "bg-white text-[#12242C] shadow-sm"
                    : "text-[#3E4E56] hover:text-[#12242C]"
                }`}
              >
                <t.icon size={18} strokeWidth={2} />
                {t.label}
              </button>
            ))}
          </nav>

          {tab === "settings" ? (
            <div className="mt-8">
              <PatientSettings />
            </div>
          ) : (
            <div className="mt-8 space-y-10">
              {liveBookings.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-xl font-semibold">Your consultation is live</h2>
                  {rejoinError && <p className="text-sm text-[#B23A3A]">{rejoinError}</p>}
                  {liveBookings.map((booking) => (
                    <div
                      key={booking.bookingId}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-[#1E8E5A]/40 bg-[#1E8E5A]/5 px-4 py-4"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-[#1E8E5A]" />
                        <span className="text-base text-black">
                          {booking.doctorName || "Your doctor"} · in progress
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRejoinCall(booking)}
                        className="rounded-lg px-5 py-3 text-base font-semibold text-white"
                        style={{ backgroundColor: "#1E8E5A" }}
                      >
                        Rejoin call
                      </button>
                    </div>
                  ))}
                </section>
              )}

              {groups.length === 0 ? (
                <section className="rounded-xl border border-dashed border-black/20 px-5 py-10 text-center">
                  <p className="text-lg font-medium">You don't have any appointments yet.</p>
                  <p className="mt-1 text-base text-black/70">
                    Book a consultation and it will appear here.
                  </p>
                  <a
                    href="/book"
                    className="mt-5 inline-flex items-center gap-2 rounded-lg px-5 py-3 text-base font-semibold text-white"
                    style={{ backgroundColor: "#0095D9" }}
                  >
                    <CalendarPlus size={18} strokeWidth={2} />
                    Book a consultation
                  </a>
                </section>
              ) : (
                <>
                  <div className="flex justify-end">
                    <a
                      href="/book"
                      className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-base font-semibold text-white"
                      style={{ backgroundColor: "#0095D9" }}
                    >
                      <CalendarPlus size={18} strokeWidth={2} />
                      Book a consultation
                    </a>
                  </div>
                  {groups.map((group) => (
                    <section key={group.key} aria-labelledby={`group-${group.key}`}>
                      <h2
                        id={`group-${group.key}`}
                        className="flex items-center gap-2.5 text-xl font-semibold text-[#12242C]"
                      >
                        <group.icon size={22} strokeWidth={1.75} className="text-[#0095D9]" />
                        {group.title}
                        <span className="rounded-full bg-[#0095D9]/10 px-2.5 py-0.5 text-sm font-semibold text-[#0B6BA0]">
                          {group.items.length}
                        </span>
                      </h2>
                      <p className="mt-1 text-base text-black/70">{group.help}</p>
                      <div className="mt-4 space-y-3">
                        {group.items.map((booking) => (
                          <BookingCard
                            key={booking.bookingId}
                            booking={booking}
                            refund={refunds[booking.consultationId]}
                            defaultPhone={profile?.phone}
                            onRefundRequested={reloadRefunds}
                            onRescheduled={() => {}}
                            onJoined={handleJoined}
                            onRejoinCall={handleRejoinCall}
                            onPaymentConfirmed={reloadBookings}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </>
              )}

              {slots.length > 0 && (
                <section>
                  <AvailableSlots slots={slots} />
                </section>
              )}

              <section>
                <h2 className="text-xl font-semibold">Past consultations</h2>
                <p className="mt-1 text-base text-black/70">
                  Closed consultations: doctor, times and amount paid. The
                  personal details you gave when booking are deleted once a
                  consultation closes.
                </p>
                <div className="mt-4">
                  {history === null ? (
                    <p className="text-base text-black/70">Loading…</p>
                  ) : (
                    <ConsultationHistory
                      consultations={history}
                      refunds={refunds}
                      defaultPhone={profile?.phone}
                      onRefundRequested={reloadRefunds}
                    />
                  )}
                </div>
              </section>
            </div>
          )}
        </main>

        {consentFor && (
          <CallConsentDialog
            busy={consentBusy}
            onAgree={() => handleRejoinCall(consentFor, CURRENT_CALL_CONSENT)}
            onCancel={() => setConsentFor(null)}
          />
        )}

        {activeCallBooking && (
          <VideoCallModal
            key={`${activeCall.bookingId}-${activeCall.patientSeq}`}
            consultationId={activeCallBooking.consultationId}
            role="patient"
            patientSeq={activeCall.patientSeq}
            viewerName={profile?.name}
            onClose={() => setActiveCall(null)}
          />
        )}

        <Footer />
      </div>
    </div>
  );
}
