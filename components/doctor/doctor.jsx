import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  ShieldCheck,
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
import { currentDoctor } from "./docMockData";
import {
  fetchAssignedConsultations,
  startVideoCall,
  markConsultationDone,
} from "./docFirestoreService";
// NEW: shared Jitsi video call modal (same component the patient side uses)
import VideoCallModal from "../video/VideoCallModal";
// TODO: point this at your actual logo file in src/assets (filename may differ).
import hospitalLogo from "../../src/assets/logo.png";

const TABS = [
  { id: "schedule", label: "Schedule", icon: CalendarDays },
  { id: "profile", label: "My profile", icon: UserRound },
];

function isSameDay(isoA, isoB) {
  const a = new Date(isoA);
  const b = new Date(isoB);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function DoctorDashboard() {
  const [activeTab, setActiveTab] = useState("schedule");
  const [consultations, setConsultations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [startingCallId, setStartingCallId] = useState(null);
  const [markDoneTarget, setMarkDoneTarget] = useState(null);
  const [toast, setToast] = useState(null);
  // NEW: which consultation's call is currently open full-screen, if any
  const [activeCallConsultationId, setActiveCallConsultationId] =
    useState(null);

  const today = new Date();

  useEffect(() => {
    let active = true;
    fetchAssignedConsultations(currentDoctor.uid).then((data) => {
      if (active) {
        setConsultations(data);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

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
    (c) => c.mode === "online" && c.callStartedAt,
  ).length;

  function showToast(message, duration = 3000) {
    setToast(message);
    setTimeout(() => setToast(null), duration);
  }

  async function handleStartCall(consultationId) {
    setStartingCallId(consultationId);
    const result = await startVideoCall(consultationId);
    setConsultations((prev) =>
      prev.map((c) =>
        c.consultationId === consultationId
          ? { ...c, callStartedAt: result.callStartedAt }
          : c,
      ),
    );
    setStartingCallId(null);
    showToast("Connected to the video room");
    // NEW: actually open the video call now that the room is marked started
    setActiveCallConsultationId(consultationId);
  }

  async function handleMarkDoneSubmit({ consultation, outcome }) {
    // amountPaid still travels to the service call because the (mocked)
    // server-side forfeit math needs it — the doctor UI never reads it back.
    await markConsultationDone({
      consultationId: consultation.consultationId,
      outcome,
      amountPaid: consultation.amountPaid,
    });
    // Erasure (4.6): the session disappears from this dashboard entirely,
    // same as it would once the real records are deleted in Firestore.
    setConsultations((prev) =>
      prev.filter((c) => c.consultationId !== consultation.consultationId),
    );
    setMarkDoneTarget(null);
    showToast(
      outcome === "No-show"
        ? "Marked no-show — session record erased"
        : "Marked completed — session record erased",
      3500,
    );
  }

  // TODO(auth): call Firebase Auth's signOut(auth) here and let the app's
  // route guard react to the auth-state change to send the doctor back to
  // the login screen. LogoutButton already handles its own confirm step
  // and loading state — this just needs to perform the actual sign-out.
  async function handleLogout() {
    await new Promise((resolve) => setTimeout(resolve, 400));
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
            <LogoutButton onConfirm={handleLogout} />
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
                {currentDoctor.name}
              </h1>
              <p className="text-xs text-[#5C6B72] sm:text-sm">
                {currentDoctor.department}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#5C6B72]">
            <ShieldCheck
              size={14}
              strokeWidth={2}
              style={{ color: "#0095D9" }}
            />
            MFA active
            <span className="mx-1">·</span>
            {today.toLocaleDateString(undefined, {
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
          <ProfileTab doctor={currentDoctor} onToast={showToast} />
        )}
      </main>

      {markDoneTarget && (
        <MarkDoneModal
          consultation={markDoneTarget}
          onClose={() => setMarkDoneTarget(null)}
          onSubmit={handleMarkDoneSubmit}
        />
      )}

      {/* NEW: full-screen video call, shown whenever a call is active */}
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
