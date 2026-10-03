import { useEffect, useMemo, useState } from "react";
// ADDED — real auth instead of mock identity.
import { useNavigate, Link } from "react-router-dom";
import { STAFF_LOGIN_PATH } from "../../src/staffRoute.js";
import {
  CalendarClock,
  Video,
  Clock3,
  Stethoscope,
  CalendarDays,
  UserRound,
} from "lucide-react";
import StatTile from "./ui/statTile";
import ConsultationCard from "./ui/consultationCard";
import MarkDoneModal from "./ui/markDoneModal";
import ProfileTab from "./docProfileTab";
import LogoutButton from "./logoutButton";
// REMOVED: import { currentDoctor } from "./docMockData";
// ASSUMPTION: this file lives at src/components/doctor/DoctorDashboard.jsx,
// matching the "../../src/assets/logo.png" import already below — so
// "../../context/authContext.jsx" resolves to src/context/authContext.jsx,
// the same file signIn.jsx already imports. Adjust if your actual depth
// differs.
import { useAuth } from "../../src/context/authContext.jsx";
import {
  fetchAssignedConsultations,
  startVideoCall,
  markConsultationDone,
} from "./docFirestoreService";
import VideoCallModal from "../video/videoCallModal";
import hospitalLogo from "../../src/assets/logo.png";
import { callableMessage, HOSPITAL_TIME_ZONE } from "../../src/constants";

const TABS = [
  { id: "schedule", label: "Schedule", icon: CalendarDays },
  { id: "profile", label: "My profile", icon: UserRound },
];

// Calendar day in hospital time.
function dayKey(value) {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: HOSPITAL_TIME_ZONE });
}
function isSameDay(a, b) {
  return dayKey(a) === dayKey(b);
}

export default function DoctorDashboard() {
  // ---- All hooks live here, unconditionally, before any early return
  // below — the auth guard only affects what gets rendered, never which
  // hooks run, since React requires the same hooks in the same order on
  // every render. ----
  const { user, profile, initializing, signOutUser } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("schedule");
  const [consultations, setConsultations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [startingCallId, setStartingCallId] = useState(null);
  const [markDoneTarget, setMarkDoneTarget] = useState(null);
  const [toast, setToast] = useState(null);
  const [activeCallConsultationId, setActiveCallConsultationId] =
    useState(null);

  const [today] = useState(() => new Date());

  // The real signed-in doctor, resolved from Firestore via authContext
  // (adminUsers doc, role: "doctor"). null until both `user` and
  // `profile` are populated — everything below that depends on this
  // checks for that, and the guard clauses further down stop the real
  // dashboard from rendering until it's ready.
  const doctor =
    user && profile
      ? {
          uid: user.uid,
          name: profile.name,
          department: profile.department || "Department not set",
          role: profile.role,
        }
      : null;

  useEffect(() => {
    if (!doctor?.uid) return;
    let active = true;
    fetchAssignedConsultations(doctor.uid)
      .then((data) => {
        if (active) setConsultations(data ?? []);
      })
      .catch((err) => {
        console.error("Failed to load consultations:", err);
        if (active) {
          setConsultations([]);
          showToast("Couldn't load your schedule. Please refresh.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [doctor?.uid]);

  const { todayList, upcomingList } = useMemo(() => {
    const sorted = [...consultations].sort(
      (a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime),
    );
    return {
      todayList: sorted.filter((c) => isSameDay(c.scheduledTime, today)),
      upcomingList: sorted.filter((c) => !isSameDay(c.scheduledTime, today)),
    };
  }, [consultations, today]);

  const liveCallCount = consultations.filter(
    (c) => c.mode === "online" && c.status === "in_progress",
  ).length;

  function showToast(message, duration = 3000) {
    setToast(message);
    setTimeout(() => setToast(null), duration);
  }

  // Resolves { ok } so the ID modal can show a mismatch inline. The
  // server checks the typed ID; the client never compares it.
  async function handleStartCall(consultationId, enteredId) {
    setStartingCallId(consultationId);
    try {
      const result = await startVideoCall(consultationId, enteredId);
      setConsultations((prev) =>
        prev.map((c) =>
          c.consultationId === consultationId
            ? {
                ...c,
                status: "in_progress",
                callStartedAt: result.callStartedAt
                  ? new Date(result.callStartedAt)
                  : c.callStartedAt,
              }
            : c,
        ),
      );
      setActiveCallConsultationId(consultationId);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: callableMessage(err, "Couldn't open the video room.") };
    } finally {
      setStartingCallId(null);
    }
  }

  async function handleMarkDoneSubmit({ consultation, outcome }) {
    try {
      await markConsultationDone({
        consultationId: consultation.consultationId,
        outcome,
      });
    } catch (err) {
      showToast(callableMessage(err, "Couldn't close the consultation."), 4000);
      return;
    }
    setConsultations((prev) =>
      prev.filter((c) => c.consultationId !== consultation.consultationId),
    );
    setMarkDoneTarget(null);
    showToast(
      outcome === "no_show"
        ? "Closed as no-show — booking details deleted"
        : "Closed as completed — booking details deleted",
      3500,
    );
  }

  // CHANGED — was a fake 400ms stub. Now calls real Firebase sign-out via
  // authContext, then leaves the doctor area. onAuthStateChanged will also
  // clear `user`/`profile` on its own, which is what makes the guard
  // clauses below correctly show the "please sign in" screen if this
  // component somehow stays mounted through the transition.
  async function handleLogout() {
    await signOutUser();
    navigate(STAFF_LOGIN_PATH ?? "/signin", { replace: true });
  }

  // ---- Auth guards — after all hooks, before the real render. ----
  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F8FA] text-sm text-[#5C6B72]">
        Loading your dashboard…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#F5F8FA] px-6 text-center">
        <p className="text-sm text-[#5C6B72]">
          Please sign in as a doctor to view this page.
        </p>
        <Link
          to="/signin"
          className="rounded-sm px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: "#0095D9" }}
        >
          Sign in
        </Link>
      </div>
    );
  }

  if (profile?.role !== "doctor") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#F5F8FA] px-6 text-center">
        <p className="text-sm text-[#5C6B72]">
          This page is only available to doctor accounts.
        </p>
        <Link
          to="/"
          className="rounded-sm border border-[#DCE6EC] px-4 py-2 text-sm font-medium text-[#12242C] hover:border-[#0095D9]"
        >
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F8FA] text-[#12242C]">
      <header className="border-b border-[#DCE6EC] bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4 sm:px-6">
          <img
            src={hospitalLogo}
            alt="Holy Family Catholic Hospital logo"
            className="h-9 w-9 shrink-0 object-contain sm:h-11 sm:w-11"
          />
          <div className="flex w-full items-center justify-between">
            <div>
              <p className="text-base font-semibold leading-tight text-[#12242C] sm:text-lg">
                Holy Family Catholic Hospital
              </p>
              <p className="text-xs text-[#5C6B72]">Doctor portal</p>
            </div>
            <div className="flex items-center gap-2">
              <LogoutButton onConfirm={handleLogout} />
            </div>
          </div>
        </div>

        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 border-t border-[#DCE6EC] px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
              style={{ backgroundColor: "#0095D9" }}
            >
              <Stethoscope
                size={17}
                strokeWidth={1.75}
                className="text-white"
              />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-[#12242C] sm:text-base">
                {doctor.name}
              </h1>
              <p className="text-xs text-[#5C6B72] sm:text-sm">
                {doctor.department}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#5C6B72]">
            {today.toLocaleDateString(undefined, {
              timeZone: HOSPITAL_TIME_ZONE,
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </div>
        </div>

        <div className="mx-auto grid max-w-5xl grid-cols-3 divide-x divide-[#DCE6EC] border-t border-[#DCE6EC]">
          <StatTile
            label="Assigned to you"
            value={consultations.length}
            icon={CalendarClock}
          />
          <StatTile label="Today" value={todayList.length} icon={Clock3} />
          <StatTile
            label="Calls in progress"
            value={liveCallCount}
            icon={Video}
            tone="live"
          />
        </div>

        <nav className="mx-auto flex max-w-5xl gap-1 border-t border-[#DCE6EC] px-4 sm:px-6">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition"
                style={
                  isActive
                    ? { borderColor: "#0095D9", color: "#0095D9" }
                    : { borderColor: "transparent", color: "#5C6B72" }
                }
              >
                <tab.icon size={15} strokeWidth={1.75} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {activeTab === "schedule" && (
          <>
            <section>
              <h2 className="mb-3 text-sm font-medium text-[#5C6B72]">Today</h2>
              {loading ? (
                <div className="rounded-md border border-dashed border-[#DCE6EC] bg-white p-8 text-center text-sm text-[#5C6B72]">
                  Loading your schedule…
                </div>
              ) : todayList.length === 0 ? (
                <div className="rounded-md border border-dashed border-[#DCE6EC] bg-white p-8 text-center text-sm text-[#5C6B72]">
                  Nothing on today's schedule. New assignments will appear here
                  once admin issues a consultation ID against your account.
                </div>
              ) : (
                <div className="space-y-3">
                  {todayList.map((c) => (
                    <ConsultationCard
                      key={c.consultationId}
                      consultation={c}
                      startingCall={startingCallId === c.consultationId}
                      onStartCall={handleStartCall}
                      onMarkDone={setMarkDoneTarget}
                    />
                  ))}
                </div>
              )}
            </section>

            {!loading && upcomingList.length > 0 && (
              <section className="mt-10">
                <h2 className="mb-3 text-sm font-medium text-[#5C6B72]">
                  Upcoming
                </h2>
                <div className="space-y-3">
                  {upcomingList.map((c) => (
                    <ConsultationCard
                      key={c.consultationId}
                      consultation={c}
                      startingCall={startingCallId === c.consultationId}
                      onStartCall={handleStartCall}
                      onMarkDone={setMarkDoneTarget}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {activeTab === "profile" && (
          <ProfileTab doctor={doctor} onToast={showToast} />
        )}
      </main>

      {markDoneTarget && (
        <MarkDoneModal
          consultation={markDoneTarget}
          onClose={() => setMarkDoneTarget(null)}
          onSubmit={handleMarkDoneSubmit}
        />
      )}

      {activeCallConsultationId && (
        <VideoCallModal
          consultationId={activeCallConsultationId}
          role="doctor"
          onClose={() => setActiveCallConsultationId(null)}
        />
      )}

      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-md px-4 py-2.5 text-sm text-white shadow-lg"
          style={{ backgroundColor: "#12242C" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
