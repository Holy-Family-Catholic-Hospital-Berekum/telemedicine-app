import { useMemo, useState } from "react";

import Sidebar from "./sidebar.jsx";
import OverviewPanel from "./overviewPanel.jsx";
import BookingsPanel from "./bookingsPanel.jsx";
import HistoryPanel from "./historyPanel.jsx";
import Users from "./users.jsx";
import RevenuePanel from "./revenuePanel.jsx";
import ActivityPanel from "./activityPanel.jsx";
import AuditPanel from "./auditPanel.jsx";
import MetricsPanel from "./metricsPanel.jsx";
import { IconBell, IconRefresh } from "./icons.jsx";

import {
  doctors as seedDoctors,
  bookings as seedBookings,
  users as seedUsers, // ASSUMPTION: add this export to mockAdminData.js — see note below
  activityEvents as seedActivity,
  auditLogEntries as seedAudit,
  confirmedPayments as seedPayments,
  consultationHistory as seedHistory,
  availableSlots as seedSlots,
  weeklyMetrics,
  outcomeBreakdown,
  overviewStats as seedStats,
} from "./mockAdminData.js";

import "./admin.css";

// The signed-in admin. Replace with useAuth() once AuthContext is wired up —
// role and mfaEnabled come from the adminUsers collection (architecture 4.1).
const CURRENT_ADMIN = {
  uid: "admin-ama",
  name: "Ama Serwaa",
  initials: "AS",
  role: "Administrator",
};

const TAB_TITLES = {
  overview: {
    title: "Overview",
    sub: "Today at a glance across bookings, payments and consultations",
  },
  bookings: {
    title: "New bookings",
    sub: "Assign a doctor and time slot to paid bookings",
  },
  history: {
    title: "Consultation history",
    sub: "When sessions ran and how they ended",
  },
  users: {
    title: "Users",
    sub: "Manage patient and doctor accounts",
  },
  revenue: {
    title: "Revenue",
    sub: "Confirmed fees, and how they reconcile with the MoMo statement",
  },
  activity: {
    title: "Activity",
    sub: "Reference-ledger events, including blocked reuse attempts",
  },
  audit: {
    title: "Audit log",
    sub: "A permanent record of staff actions on this system",
  },
  metrics: {
    title: "Metrics & reports",
    sub: "Anonymised consultation volume — no patient identifiers are stored",
  },
};

let auditSeq = 100;
let activitySeq = 100;
let historySeq = 100;
let slotSeq = 1004;

export default function Admin({ onLogout = () => {} }) {
  const [tab, setTab] = useState("overview");

  // Local state stands in for Firestore onSnapshot subscriptions. Each setter
  // below is the point where you'd instead call a Cloud Function and let the
  // snapshot listener update the UI.
  const [doctors] = useState(seedDoctors);
  const [bookings, setBookings] = useState(seedBookings);
  const [users, setUsers] = useState(seedUsers);
  const [activity, setActivity] = useState(seedActivity);
  const [audit, setAudit] = useState(seedAudit);
  const [payments] = useState(seedPayments);
  const [history, setHistory] = useState(seedHistory);
  const [slots, setSlots] = useState(seedSlots);

  const pushAudit = (action, targetId) =>
    setAudit((prev) => [
      {
        id: `aud-${auditSeq++}`,
        actorId: CURRENT_ADMIN.uid,
        action,
        targetId,
        timestamp: new Date().toISOString(),
      },
      ...prev,
    ]);

  const pushActivity = (type, referenceCode, account = CURRENT_ADMIN.uid) =>
    setActivity((prev) => [
      {
        id: `act-${activitySeq++}`,
        type,
        referenceCode,
        account,
        timestamp: new Date().toISOString(),
      },
      ...prev,
    ]);

  // 4.4 Admin Service — assign doctor + slot; the Cloud Function generates the
  // consultation ID. schedulingModal.jsx mocks that ID for now.
  const handleSchedule = ({
    bookingId,
    doctorId,
    scheduledTime,
    consultationId,
  }) => {
    setBookings((prev) =>
      prev.map((b) =>
        b.bookingId === bookingId
          ? {
              ...b,
              doctorId,
              scheduledTime,
              consultationId,
              rescheduleRequested: false,
            }
          : b,
      ),
    );
    pushAudit("Scheduled consultation", bookingId);
  };

  // 4.6 Metrics and Data Erasure. In the real system this is one Cloud
  // Function running in a single transaction: write the anonymised history
  // row, expire the consultation ID, then delete the booking. Admin may only
  // close in-person sessions; online sessions are closed by the doctor.
  const handleMarkDone = (booking) => {
    const endedAt = new Date().toISOString();
    const startedAt =
      booking.mode === "In person"
        ? booking.scheduledTime
        : (booking.callStartedAt ?? booking.scheduledTime);

    setHistory((prev) => [
      {
        id: `hist-${historySeq++}`,
        consultationId: booking.consultationId,
        type: booking.type,
        mode: booking.mode,
        doctorOrDept:
          doctors.find((d) => d.id === booking.doctorId)?.name ?? "—",
        startedAt,
        endedAt,
        outcome: "Completed",
      },
      ...prev,
    ]);
    setBookings((prev) =>
      prev.filter((b) => b.bookingId !== booking.bookingId),
    );
    pushAudit("Marked consultation done", booking.consultationId);
  };

  // Admin opens a time window when a doctor is free. Patients see this as
  // a specific bookable slot. IMPORTANT: the overlap check in
  // CreateScheduleModal is client-side only — the Cloud Function that
  // writes availableSlots must re-check for a doctor double-booking inside
  // a transaction before committing, the same pattern used for reference
  // codes (architecture 4.3), since two admins could otherwise create
  // overlapping slots for the same doctor at the same time.
  const handleCreateSlot = ({
    doctorId,
    type,
    mode,
    date,
    startTime,
    endTime,
  }) => {
    const id = `SLOT-${slotSeq++}`;
    setSlots((prev) => [
      {
        id,
        doctorId,
        type,
        mode,
        date,
        startTime,
        endTime,
        status: "open",
        createdBy: CURRENT_ADMIN.uid,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    pushAudit("Created available slot", id);
  };

  const handleCancelSlot = (slot) => {
    setSlots((prev) => prev.filter((s) => s.id !== slot.id));
    pushAudit("Cancelled available slot", slot.id);
  };

  // ── Users tab handlers ─────────────────────────────────────────────
  // Client-side convenience only. The real create/deactivate/delete
  // operations MUST be Cloud Functions that re-check, server-side, that
  // the caller is an admin and that the target is neither an admin nor
  // the caller themselves — see users.jsx's own comment on this.
  const handleCreateDoctor = async (form) => {
    // ASSUMPTION: replace with a call to a callable Cloud Function, e.g.
    //   const fns = getFunctions(app, FUNCTIONS_REGION);
    //   await httpsCallable(fns, "createDoctorAccount")(form);
    const id = `doc-${Math.floor(1000 + Math.random() * 9000)}`;
    const newDoctor = {
      id,
      name: form.name,
      email: form.email,
      phone: form.phone,
      specialty: form.specialty,
      role: "doctor",
      status: "active",
      createdAt: new Date().toISOString(),
    };
    setUsers((prev) => [newDoctor, ...prev]);
    pushAudit("Created doctor account", id);
  };

  const handleDeactivateUser = (user) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === user.id ? { ...u, status: "deactivated" } : u)),
    );
    pushAudit("Deactivated account", user.id);
  };

  const handleReactivateUser = (user) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === user.id ? { ...u, status: "active" } : u)),
    );
    pushAudit("Reactivated account", user.id);
  };

  const handleDeleteUser = (user) => {
    setUsers((prev) => prev.filter((u) => u.id !== user.id));
    pushAudit("Deleted account", user.id);
  };

  const toSchedule = useMemo(
    () =>
      bookings.filter((b) => b.paymentStatus !== "failed" && !b.consultationId),
    [bookings],
  );

  const stats = useMemo(
    () => ({
      ...seedStats,
      pendingPayments: toSchedule.length,
      doctorsOnDuty: doctors.filter((d) => d.available).length,
    }),
    [toSchedule.length, doctors],
  );

  const heading = TAB_TITLES[tab] ?? TAB_TITLES.overview;

  return (
    <div className="admin-shell">
      <Sidebar
        active={tab}
        onChange={setTab}
        admin={CURRENT_ADMIN}
        pendingCount={toSchedule.length}
        onLogout={onLogout}
      />

      <main className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-heading">
            <h1>{heading.title}</h1>
            <p>{heading.sub}</p>
          </div>

          <div className="admin-topbar-actions">
            <span className="admin-today">
              {new Date().toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </span>
            <button className="admin-icon-btn" title="Refresh data">
              <IconRefresh size={17} />
            </button>
            <button className="admin-icon-btn" title="Notifications">
              <IconBell size={17} />
              {toSchedule.length > 0 && <span className="dot" />}
            </button>
          </div>
        </header>

        <div className="admin-content">
          {tab === "overview" && (
            <OverviewPanel
              stats={stats}
              weeklyMetrics={weeklyMetrics}
              recentActivity={activity}
            />
          )}

          {tab === "bookings" && (
            <BookingsPanel
              bookings={bookings}
              doctors={doctors}
              slots={slots}
              onSchedule={handleSchedule}
              onMarkDone={handleMarkDone}
              onCreateSlot={handleCreateSlot}
              onCancelSlot={handleCancelSlot}
            />
          )}

          {tab === "history" && <HistoryPanel history={history} />}

          {tab === "users" && (
            <Users
              users={users}
              currentAdminId={CURRENT_ADMIN.uid}
              onCreateDoctor={handleCreateDoctor}
              onDeactivate={handleDeactivateUser}
              onReactivate={handleReactivateUser}
              onDelete={handleDeleteUser}
            />
          )}

          {tab === "revenue" && <RevenuePanel payments={payments} />}

          {tab === "activity" && <ActivityPanel events={activity} />}

          {tab === "audit" && <AuditPanel entries={audit} />}

          {tab === "metrics" && (
            <MetricsPanel
              weeklyMetrics={weeklyMetrics}
              outcomeBreakdown={outcomeBreakdown}
            />
          )}
        </div>
      </main>
    </div>
  );
}
