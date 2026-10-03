import { useMemo, useState, useCallback } from "react";
import { collection, query, orderBy, where, limit } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { sendPasswordResetEmail } from "firebase/auth";

import { db, functions, auth } from "../../src/firebase";
import { useAuth } from "../../src/context/authContext.jsx";
import { callableMessage } from "../../src/constants";
import { useFirestoreCollection } from "./hooks/useFirestoreCollection.js";
import { useWeeklyMetrics } from "./hooks/useWeeklyMetrics.js";
import { useOutcomeBreakdown } from "./hooks/useOutcomeBreakdown.js";

import Sidebar from "./sidebar.jsx";
import OverviewPanel from "./overviewPanel.jsx";
import BookingsPanel from "./bookingsPanel.jsx";
import HistoryPanel from "./historyPanel.jsx";
import Users from "./users.jsx";
import RevenuePanel from "./revenuePanel.jsx";
import AuditPanel from "./auditPanel.jsx";
import MetricsPanel from "./metricsPanel.jsx";
import RecordingsPanel from "./recordingsPanel.jsx";
import ControlPanel from "./controlPanel.jsx";
import { IconBell, IconRefresh } from "./icons.jsx";

import "./admin.css";

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
    sub: "When sessions ran, how they ended and what was paid",
  },
  users: {
    title: "Users",
    sub: "Manage patient and doctor accounts",
  },
  recordings: {
    title: "Call recordings",
    sub: "Play, download or delete recorded consultations. Every access is logged",
  },
  revenue: {
    title: "Revenue",
    sub: "Payments confirmed by Paystack",
  },
  audit: {
    title: "Audit log",
    sub: "A permanent record of actions on this system",
  },
  metrics: {
    title: "Metrics & reports",
    sub: "Consultation volume and outcomes",
  },
  control: {
    title: "Control panel",
    sub: "Call recording, site photos, prices and legal pages",
  },
};

const RECENT_LOG_LIMIT = 200;
const HISTORY_LIMIT = 500;

export default function Admin() {
  const [tab, setTab] = useState("overview");
  const { user, profile, signOutUser } = useAuth();

  const currentAdmin = useMemo(
    () => ({
      uid: user?.uid ?? null,
      name: profile?.name || "Admin",
      initials: initialsOf(profile?.name),
      role: profile?.role === "admin" ? "Administrator" : (profile?.role ?? "—"),
    }),
    [user, profile],
  );

  // Paid and scheduled bookings only: unpaid drafts never reach admin.
  const bookingsQuery = useMemo(
    () =>
      query(
        collection(db, "bookings"),
        where("status", "in", ["paid", "scheduled"]),
        orderBy("createdAt", "desc"),
      ),
    [],
  );
  const usersQuery = useMemo(
    () => query(collection(db, "users"), orderBy("createdAt", "desc")),
    [],
  );
  const staffQuery = useMemo(
    () => query(collection(db, "adminUsers"), orderBy("createdAt", "desc")),
    [],
  );
  const profilesQuery = useMemo(() => query(collection(db, "doctorProfiles")), []);
  const paymentsQuery = useMemo(
    () => query(collection(db, "confirmedPayments"), orderBy("paidAt", "desc")),
    [],
  );
  const historyQuery = useMemo(
    () =>
      query(
        collection(db, "consultationHistory"),
        orderBy("endedAt", "desc"),
        limit(HISTORY_LIMIT),
      ),
    [],
  );
  const slotsQuery = useMemo(
    () =>
      query(
        collection(db, "availableSlots"),
        where("status", "==", "open"),
        orderBy("startAt", "asc"),
      ),
    [],
  );
  const auditQuery = useMemo(
    () =>
      query(
        collection(db, "auditLog"),
        orderBy("timestamp", "desc"),
        limit(RECENT_LOG_LIMIT),
      ),
    [],
  );

  const {
    data: bookingDocs,
    loading: bookingsLoading,
    error: bookingsError,
  } = useFirestoreCollection(bookingsQuery);
  const bookings = useMemo(
    () => bookingDocs.map((b) => ({ ...b, bookingId: b.id })),
    [bookingDocs],
  );
  const { data: patientUsers } = useFirestoreCollection(usersQuery);
  const { data: staffUsers } = useFirestoreCollection(staffQuery);
  const { data: doctorProfiles } = useFirestoreCollection(profilesQuery);
  const { data: payments } = useFirestoreCollection(paymentsQuery);
  const { data: history } = useFirestoreCollection(historyQuery);
  const { data: slots } = useFirestoreCollection(slotsQuery);
  const { data: audit } = useFirestoreCollection(auditQuery);

  const users = useMemo(
    () => [
      ...staffUsers.map((u) => ({ ...u, specialty: u.department })),
      ...patientUsers.map((u) => ({ ...u, role: "patient" })),
    ],
    [staffUsers, patientUsers],
  );

  // Active doctors with their public profile (availability, types).
  const doctors = useMemo(() => {
    const profiles = new Map(doctorProfiles.map((p) => [p.id, p]));
    return staffUsers
      .filter((u) => u.role === "doctor" && u.status === "active")
      .map((u) => {
        const p = profiles.get(u.id) || {};
        return {
          id: u.id,
          name: u.name,
          department: u.department || p.roleTitle || "",
          available: p.isAvailable !== false,
          availableFor: p.availableFor || [],
        };
      });
  }, [staffUsers, doctorProfiles]);

  const weeklyMetrics = useWeeklyMetrics(history);
  const outcomeBreakdown = useOutcomeBreakdown(history);

  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);

  const callAdmin = useCallback(async (name, payload) => {
    setActionError(null);
    try {
      const res = await httpsCallable(functions, name)(payload);
      return res.data;
    } catch (err) {
      setActionError(callableMessage(err, "That action didn't go through. Please try again."));
      throw err;
    }
  }, []);

  const quietly = (promise) => promise.catch(() => {});

  const handleSchedule = ({ bookingId, doctorUid, scheduledTime }) =>
    quietly(callAdmin("scheduleConsultation", { bookingId, doctorUid, scheduledTime }));

  const handleReschedule = (payload) =>
    quietly(callAdmin("rescheduleConsultation", payload));

  const handleMarkDone = (booking, outcome) =>
    quietly(
      callAdmin("markConsultationDone", {
        consultationId: booking.consultationId,
        outcome,
      }),
    );

  const handleCreateSlot = (form) => quietly(callAdmin("createAvailableSlot", form));
  const handleCancelSlot = (slot) =>
    quietly(callAdmin("cancelAvailableSlot", { slotId: slot.id }));

  // The doctor sets their own password from Firebase's reset email.
  const handleCreateDoctor = async (form) => {
    const result = await callAdmin("createDoctorAccount", form);
    try {
      await sendPasswordResetEmail(auth, result.email);
      setNotice(`Account created. ${result.email} has been emailed a link to set a password.`);
    } catch {
      setNotice(
        `Account created, but the set-password email couldn't be sent. Ask ${result.email} to use "Forgot password" on the staff sign-in page.`,
      );
    }
    return result;
  };
  const handleDeactivateUser = (u) =>
    quietly(callAdmin("setAccountStatus", { uid: u.id, status: "deactivated" }));
  const handleReactivateUser = (u) =>
    quietly(callAdmin("setAccountStatus", { uid: u.id, status: "active" }));

  const toSchedule = useMemo(
    () => bookings.filter((b) => b.status === "paid" && !b.consultationId),
    [bookings],
  );

  const stats = useMemo(() => {
    const todayKey = new Date().toDateString();
    const todaysBookings = bookings.filter(
      (b) => b.createdAt && new Date(b.createdAt).toDateString() === todayKey,
    ).length;
    const activeConsultations = bookings.filter(
      (b) => b.status === "scheduled" && b.callStartedAt,
    ).length;
    return {
      todaysBookings,
      activeConsultations,
      doctorsOnDuty: doctors.filter((d) => d.available).length,
    };
  }, [bookings, doctors]);

  const heading = TAB_TITLES[tab] ?? TAB_TITLES.overview;

  return (
    <div className="admin-shell">
      <Sidebar
        active={tab}
        onChange={setTab}
        admin={currentAdmin}
        pendingCount={toSchedule.length}
        onLogout={signOutUser}
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
                timeZone: "Africa/Accra",
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </span>
            <button className="admin-icon-btn" title="Refresh data" onClick={() => window.location.reload()}>
              <IconRefresh size={17} />
            </button>
            <button className="admin-icon-btn" title="Bookings to schedule" onClick={() => setTab("bookings")}>
              <IconBell size={17} />
              {toSchedule.length > 0 && <span className="dot" />}
            </button>
          </div>
        </header>

        {actionError && (
          <div className="admin-alert admin-alert-error" role="alert">
            {actionError}
          </div>
        )}
        {notice && (
          <div className="admin-alert" role="status" onClick={() => setNotice(null)}>
            {notice}
          </div>
        )}
        {bookingsError && (
          <div className="admin-alert admin-alert-error">
            Couldn't load bookings. Check your connection and try again.
          </div>
        )}

        <div className="admin-content">
          {tab === "overview" && (
            <OverviewPanel
              stats={stats}
              weeklyMetrics={weeklyMetrics}
              recentActivity={audit}
            />
          )}

          {tab === "bookings" && (
            <BookingsPanel
              bookings={bookings}
              doctors={doctors}
              slots={slots}
              loading={bookingsLoading}
              onSchedule={handleSchedule}
              onReschedule={handleReschedule}
              onMarkDone={handleMarkDone}
              onCreateSlot={handleCreateSlot}
              onCancelSlot={handleCancelSlot}
            />
          )}

          {tab === "history" && <HistoryPanel history={history} />}

          {tab === "users" && (
            <Users
              users={users}
              currentAdminId={currentAdmin.uid}
              onCreateDoctor={handleCreateDoctor}
              onDeactivate={handleDeactivateUser}
              onReactivate={handleReactivateUser}
            />
          )}

          {tab === "recordings" && <RecordingsPanel callAdmin={callAdmin} />}

          {tab === "revenue" && <RevenuePanel payments={payments} />}

          {tab === "audit" && <AuditPanel entries={audit} />}

          {tab === "metrics" && (
            <MetricsPanel
              weeklyMetrics={weeklyMetrics}
              outcomeBreakdown={outcomeBreakdown}
            />
          )}

          {tab === "control" && <ControlPanel />}
        </div>
      </main>
    </div>
  );
}

function initialsOf(name) {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");
}
