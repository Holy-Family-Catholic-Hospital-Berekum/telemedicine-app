import { useMemo, useState, useCallback } from "react";
import { collection, query, orderBy, where, limit } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

import { db, app } from "../../src/firebase";
import { useAuth } from "../../src/context/authContext.jsx";
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
import ControlPanel from "./controlPanel.jsx";
import { IconBell, IconRefresh } from "./icons.jsx";

import "./admin.css";

const functions = getFunctions(app);

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
  control: {
    title: "Control panel",
    sub: "Site photos and consultation prices, live on the public site",
  },
};

const RECENT_LOG_LIMIT = 200;

export default function Admin() {
  const [tab, setTab] = useState("overview");
  const { user, profile, signOutUser } = useAuth();

  const currentAdmin = useMemo(
    () => ({
      uid: user?.uid ?? null,
      name: profile?.name || "Admin",
      initials: initialsOf(profile?.name),
      role:
        profile?.role === "admin" ? "Administrator" : (profile?.role ?? "—"),
    }),
    [user, profile],
  );

  const doctorsQuery = useMemo(() => query(collection(db, "doctors")), []);
  const bookingsQuery = useMemo(
    () => query(collection(db, "bookings"), orderBy("createdAt", "desc")),
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
  const paymentsQuery = useMemo(
    () => query(collection(db, "confirmedPayments"), orderBy("paidAt", "desc")),
    [],
  );
  const historyQuery = useMemo(
    () =>
      query(collection(db, "consultationHistory"), orderBy("endedAt", "desc")),
    [],
  );
  const slotsQuery = useMemo(
    () =>
      query(
        collection(db, "availableSlots"),
        where("status", "==", "open"),
        orderBy("date", "asc"),
      ),
    [],
  );
  const activityQuery = useMemo(
    () =>
      query(
        collection(db, "activityEvents"),
        orderBy("timestamp", "desc"),
        limit(RECENT_LOG_LIMIT),
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

  const { data: doctors } = useFirestoreCollection(doctorsQuery);
  const {
    data: bookings,
    loading: bookingsLoading,
    error: bookingsError,
  } = useFirestoreCollection(bookingsQuery);
  const { data: patientUsers } = useFirestoreCollection(usersQuery);
  const { data: staffUsers } = useFirestoreCollection(staffQuery);
  const { data: payments } = useFirestoreCollection(paymentsQuery);
  const { data: history } = useFirestoreCollection(historyQuery);
  const { data: slots } = useFirestoreCollection(slotsQuery);
  const { data: activity } = useFirestoreCollection(activityQuery);
  const { data: audit } = useFirestoreCollection(auditQuery);

  const users = useMemo(
    () => [
      ...staffUsers.map((u) => ({ role: "admin", status: "active", ...u })),
      ...patientUsers.map((u) => ({ role: "patient", status: "active", ...u })),
    ],
    [staffUsers, patientUsers],
  );

  // Shared by Overview and Metrics tabs so both read the same weekly
  // bucketing instead of computing it twice.
  const weeklyMetrics = useWeeklyMetrics(history);
  const outcomeBreakdown = useOutcomeBreakdown(history);

  const [actionError, setActionError] = useState(null);

  const callAdmin = useCallback(async (name, payload) => {
    setActionError(null);
    try {
      const fn = httpsCallable(functions, name);
      const res = await fn(payload);
      return res.data;
    } catch (err) {
      setActionError(
        err?.message || "That action didn't go through. Please try again.",
      );
      throw err;
    }
  }, []);

  const handleSchedule = ({ bookingId, doctorId, scheduledTime }) =>
    callAdmin("scheduleConsultation", { bookingId, doctorId, scheduledTime });

  const handleMarkDone = (booking) =>
    callAdmin("markConsultationDone", { bookingId: booking.bookingId });

  const handleCreateSlot = (form) => callAdmin("createAvailableSlot", form);

  const handleCancelSlot = (slot) =>
    callAdmin("cancelAvailableSlot", { slotId: slot.id });

  const handleCreateDoctor = (form) => callAdmin("createDoctorAccount", form);
  const handleDeactivateUser = (user) =>
    callAdmin("deactivateAccount", { userId: user.id });
  const handleReactivateUser = (user) =>
    callAdmin("reactivateAccount", { userId: user.id });
  const handleDeleteUser = (user) =>
    callAdmin("deleteAccount", { userId: user.id });

  // Bookings still needing a doctor/slot assigned — this is a scheduling
  // queue, not a payment-verification queue (Paystack already confirmed
  // payment before a booking is written at all).
  const toSchedule = useMemo(
    () =>
      bookings.filter((b) => b.paymentStatus !== "failed" && !b.consultationId),
    [bookings],
  );

  const stats = useMemo(() => {
    const todayKey = new Date().toDateString();
    const todaysBookings = bookings.filter((b) => {
      const created = b.createdAt?.toDate ? b.createdAt.toDate() : b.createdAt;
      return created && new Date(created).toDateString() === todayKey;
    }).length;

    // A booking still in `bookings` with a consultationId assigned is an
    // active/in-progress session — once it's done, handleMarkDone moves
    // it to `consultationHistory` and removes it from `bookings`.
    const activeConsultations = bookings.filter(
      (b) => !!b.consultationId,
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

        {actionError && (
          <div className="admin-alert admin-alert-error">{actionError}</div>
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
              recentActivity={activity}
            />
          )}

          {tab === "bookings" && (
            <BookingsPanel
              bookings={bookings}
              doctors={doctors}
              slots={slots}
              loading={bookingsLoading}
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
              currentAdminId={currentAdmin.uid}
              onCreateDoctor={handleCreateDoctor}
              onDeactivate={handleDeactivateUser}
              onReactivate={handleReactivateUser}
              onDelete={handleDeleteUser}
            />
          )}

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
