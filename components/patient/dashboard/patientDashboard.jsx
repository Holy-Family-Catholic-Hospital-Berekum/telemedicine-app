import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LogOut,
  ArrowLeft,
  CalendarCheck,
  Hourglass,
  CalendarDays,
  Settings as SettingsIcon,
  CalendarPlus,
  History as HistoryIcon,
  CalendarX2,
} from "lucide-react";
import { useAuth } from "../../../src/context/authContext.jsx";
import HealthcarePreloader from "../../../src/components/common/healthcarePreloader.jsx";

import { callableMessage, CALL_UNLOCK_MINUTES, CALL_CLOSES_HOURS } from "../../../src/constants";
import { CURRENT_CALL_CONSENT } from "../../../src/consentText";
import CallConsentDialog from "./callConsentDialog";
import {
  joinVideoCall,
  fetchMyBookings,
  fetchAvailableSlots,
  fetchConsultationHistory,
  HISTORY_STEP,
  fetchMyRefundRequests,
} from "./patientFirestoreService";

import { getCallWindow } from "./patientUtils";
import CheckPaymentPanel from "./checkPaymentPanel";
import BookingCard from "./patientBookingCard";
import AvailableSlots from "./patientAvailableSlots";
import ConsultationHistory from "./consultationHistory";
import PatientSettings from "./patientSettings";

import VideoCallModal from "../../video/videoCallModal";
import BrandAside from "../../shared/brandAside";
import logo from "../../../src/assets/logo.png";
import Footer from "../../shared/footer";
import { usePageMeta } from "../../../src/seo.js";

export default function Dashboard() {
  usePageMeta({ title: "My dashboard", noindex: true });
  const navigate = useNavigate();
  // The route is wrapped in ProtectedRoute (patient, verified email), so
  // `user` is always a signed-in patient here.
  const { user, profile, signOutUser } = useAuth();

  const [tab, setTab] = useState("appointments"); // "appointments" | "settings"
  const [bookings, setBookings] = useState(null);
  const [slots, setSlots] = useState([]);
  const [history, setHistory] = useState(null);
  const [historyMax, setHistoryMax] = useState(HISTORY_STEP);
  const [historyLoading, setHistoryLoading] = useState(false);
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


  // While a video appointment's room is open (and the patient isn't in the
  // call), refresh every 20 s: "Your doctor is in the call, join before…"
  // shows up without a reload.
  useEffect(() => {
    if (!user || activeCall) return undefined;
    const roomOpen = () =>
      (bookings ?? []).some((b) => {
        const start = b.scheduledTime?.getTime?.();
        if (b.mode !== "online" || b.status !== "scheduled" || !start || b.metAt) return false;
        const now = Date.now();
        return now > start - CALL_UNLOCK_MINUTES * 60000 && now < start + CALL_CLOSES_HOURS * 3600000;
      });
    const id = setInterval(() => {
      if (!roomOpen()) return;
      fetchMyBookings(user.uid)
        .then((data) => setBookings(data ?? []))
        .catch(() => {});
    }, 20000);
    return () => clearInterval(id);
  }, [user, bookings, activeCall]);

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

  function loadOlderHistory() {
    const next = historyMax + HISTORY_STEP;
    setHistoryLoading(true);
    fetchConsultationHistory(user.uid, next)
      .then((data) => {
        setHistory(data ?? []);
        setHistoryMax(next);
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
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
    setActiveCall({
      bookingId,
      patientSeq: result.patientSeq ?? 0,
      waitDeadline: result.waitDeadline ?? null,
    });
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
      key: "missed",
      title: "Missed appointments",
      help: "You didn't join in time. You can pay a fee to book a new time, or ask for some of your money back, before the date shown.",
      icon: CalendarX2,
      items: safeBookings.filter((b) => b.state === "no_show"),
    },
    {
      key: "waiting",
      title: "Waiting to be scheduled",
      help: "Paid. We're choosing your doctor and time, and will email you when it's set.",
      icon: Hourglass,
      items: safeBookings.filter((b) => b.state === "pending_assignment"),
    },
  ].filter((g) => g.items.length > 0);

  // No confirmed payment, no booking: an unpaid attempt is never shown as a
  // booking. While a payment is being checked (the patient tapped Pay and a
  // prompt may still go through), a notice explains why they can't book
  // again yet and lets them check it.
  const paymentsInProgress = safeBookings.filter(
    (b) => b.state === "awaiting_payment" && (b.txRefs?.length ?? 0) > 0,
  );

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
              smaller line. One clear "Back to Home" button; signing out
              lives at the bottom of Settings so nobody does it by mistake. */}
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
                  Holy Family Catholic Hospital, Berekum
                </p>
              </div>
            </div>

            <a
              href="/"
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/60 px-3 py-2 text-[14px] font-semibold text-white transition hover:bg-white/15 sm:px-4 sm:text-[15px]"
            >
              <ArrowLeft size={17} strokeWidth={2.2} />
              Back to Home
            </a>
          </div>
        </header>

        <main className="mx-auto max-w-4xl px-5 sm:px-8 py-6 sm:py-8 min-h-[calc(100dvh-64px+5rem)] w-full">
          {/* Three big, plain tabs (short labels on phones). */}
          <nav className="grid grid-cols-3 gap-1.5 rounded-xl bg-[#F1F5F8] p-1.5 sm:gap-2" aria-label="Dashboard">
            {[
              { id: "appointments", label: "My appointments", short: "Appointments", icon: CalendarDays },
              { id: "history", label: "Past consultations", short: "History", icon: HistoryIcon },
              { id: "settings", label: "Settings", short: "Settings", icon: SettingsIcon },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1.5 py-2.5 text-[15px] font-semibold transition sm:flex-row sm:gap-2 sm:px-3 sm:py-3 sm:text-base ${
                  tab === t.id
                    ? "bg-white text-[#12242C] shadow-sm"
                    : "text-[#3E4E56] hover:text-[#12242C]"
                }`}
              >
                <t.icon size={18} strokeWidth={2} className="shrink-0" />
                <span className="truncate sm:hidden">{t.short}</span>
                <span className="hidden truncate sm:inline">{t.label}</span>
              </button>
            ))}
          </nav>

          {tab === "settings" ? (
            <div className="mt-8">
              <PatientSettings />
              <div className="mt-12 border-t border-black/10 pt-5">
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1.5 text-[15px] text-black/70 underline-offset-2 hover:text-black hover:underline"
                >
                  <LogOut size={15} strokeWidth={1.9} />
                  Sign out of this device
                </button>
              </div>
            </div>
          ) : tab === "history" ? (
            <section className="mt-8">
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
                    canLoadMore={history.length >= historyMax}
                    loadingMore={historyLoading}
                    onLoadMore={loadOlderHistory}
                  />
                )}
              </div>
            </section>
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

              {paymentsInProgress.length > 0 && (
                <section
                  aria-labelledby="payments-in-progress"
                  className="rounded-xl border border-[#0095D9]/30 bg-[#0095D9]/5 px-4 py-4"
                >
                  <h2 id="payments-in-progress" className="text-lg font-semibold text-[#12242C]">
                    We're checking a payment
                  </h2>
                  {paymentsInProgress.map((b) => (
                    <div key={b.bookingId} className="mt-2">
                      <CheckPaymentPanel booking={b} onConfirmed={reloadBookings} onFailed={reloadBookings} />
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
                            onRescheduled={(bookingId, result) => {
                              // A late reschedule turns the booking into a
                              // missed one (fee); show its new state.
                              if (!result || result.status === "pay") reloadBookings();
                            }}
                            onJoined={handleJoined}
                            onRejoinCall={handleRejoinCall}
                            onNoShowRescheduled={reloadBookings}
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
            waitDeadline={activeCall.waitDeadline}
            viewerName={profile?.name}
            onClose={() => {
              setActiveCall(null);
              reloadBookings(); // e.g. the doctor couldn't make it
            }}
          />
        )}

        <Footer />
      </div>
    </div>
  );
}
