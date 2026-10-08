import { useMemo, useState, useCallback } from "react";
import { Timestamp, collection, query, orderBy, where, limit } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { sendPasswordResetEmail } from "firebase/auth";

import { db, functions, auth } from "../../src/firebase";
import { useAuth } from "../../src/context/authContext.jsx";
import { callableMessage } from "../../src/constants";
import { useFirestoreCollection } from "./hooks/useFirestoreCollection.js";
import { useWindowedCollection } from "./hooks/useWindowedCollection.js";
import { useWeeklyMetrics } from "./hooks/useWeeklyMetrics.js";
import { useOutcomeBreakdown } from "./hooks/useOutcomeBreakdown.js";

import Sidebar from "./sidebar.jsx";
import StaffAccountSettings from "../shared/staffAccountSettings.jsx";
import OverviewPanel from "./overviewPanel.jsx";
import BookingsPanel from "./bookingsPanel.jsx";
import HistoryPanel from "./historyPanel.jsx";
import Users from "./users.jsx";
import RevenuePanel from "./revenuePanel.jsx";
import AuditPanel from "./auditPanel.jsx";
import MetricsPanel from "./metricsPanel.jsx";
import RecordingsPanel from "./recordingsPanel.jsx";
import PaymentIssuesPanel from "./paymentIssuesPanel.jsx";
import RefundRequestsPanel from "./refundRequestsPanel.jsx";
import ControlPanel from "./controlPanel.jsx";
import { IconBell, IconRefresh } from "./icons.jsx";

import "./admin.css";
import { usePageMeta } from "../../src/seo.js";

const TAB_TITLES = {
  account: {
    title: "My account",
    sub: "Your name and the email you sign in with",
  },
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

// Collections that grow without limit are loaded as a window of the most
// recent records (useWindowedCollection), which the admin can extend with
// "Load older". Panels paginate whatever is loaded.
const WINDOW = 500;
const bookingsWindow = (n) =>
  query(
    collection(db, "bookings"),
    // Paid, scheduled and held no-show bookings: unpaid drafts never
    // reach admin.
    where("status", "in", ["paid", "scheduled", "no_show"]),
    orderBy("createdAt", "desc"),
    limit(n),
  );
const patientsWindow = (n) => query(collection(db, "users"), orderBy("createdAt", "desc"), limit(n));
const historyWindow = (n) =>
  query(collection(db, "consultationHistory"), orderBy("endedAt", "desc"), limit(n));
const auditWindow = (n) => query(collection(db, "auditLog"), orderBy("timestamp", "desc"), limit(n));
// Refunds waiting for an admin (badge on the Revenue tab): patient refund
// requests to decide or that Paystack refused, and automatic refunds of
// flagged payments (duplicates, late payments) that Paystack refused.
const pendingRefundsQuery = query(
  collection(db, "refundRequests"),
  where("status", "in", ["requested", "failed"]),
);
const refundDueIssuesQuery = query(
  collection(db, "paymentIssues"),
  where("status", "in", ["refund_due", "refund_failed"]),
);

export default function Admin() {
  usePageMeta({ title: "Admin", noindex: true });
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

  const staffQuery = useMemo(
    () => query(collection(db, "adminUsers"), orderBy("createdAt", "desc")),
    [],
  );
  const profilesQuery = useMemo(() => query(collection(db, "doctorProfiles")), []);
  const slotsQuery = useMemo(
    () =>
      query(
        collection(db, "availableSlots"),
        where("status", "==", "open"),
        orderBy("startAt", "asc"),
      ),
    [],
  );
  // Today's slots of any status (open, held or booked) for "on duty".
  const todayDate = useMemo(() => hospitalDay(new Date()), []);
  const todaySlotsQuery = useMemo(
    () => query(collection(db, "availableSlots"), where("date", "==", todayDate)),
    [todayDate],
  );
  // Bookings confirmed today (paid, or booked to pay at the hospital),
  // counted from bookingLog so closed consultations still count. Hospital
  // time is UTC, so today starts at UTC midnight.
  const bookingLogTodayQuery = useMemo(
    () =>
      query(
        collection(db, "bookingLog"),
        where("confirmedAt", ">=", Timestamp.fromMillis(Date.parse(`${todayDate}T00:00:00Z`))),
      ),
    [todayDate],
  );
  const { data: bookingLogToday } = useFirestoreCollection(bookingLogTodayQuery);
  const bookingsWin = useWindowedCollection(bookingsWindow, WINDOW);
  const { data: bookingDocs, error: bookingsError } = bookingsWin;
  // "Loading" only before the first rows arrive, not while loading older ones.
  const bookingsLoading = bookingsWin.loading && bookingsWin.loaded === 0;
  const bookings = useMemo(
    () => bookingDocs.map((b) => ({ ...b, bookingId: b.id })),
    [bookingDocs],
  );
  const patientsWin = useWindowedCollection(patientsWindow, WINDOW);
  const patientUsers = patientsWin.data;
  const { data: staffUsers } = useFirestoreCollection(staffQuery);
  const { data: doctorProfiles } = useFirestoreCollection(profilesQuery);
  const historyWin = useWindowedCollection(historyWindow, WINDOW);
  const history = historyWin.data;
  const { data: slots } = useFirestoreCollection(slotsQuery);
  const { data: todaySlots } = useFirestoreCollection(todaySlotsQuery);
  const auditWin = useWindowedCollection(auditWindow, WINDOW);
  const audit = auditWin.data;
  const { data: pendingRefunds } = useFirestoreCollection(pendingRefundsQuery);
  const { data: refundDueIssues } = useFirestoreCollection(refundDueIssuesQuery);
  const refundsToHandle = pendingRefunds.length + refundDueIssues.length;

  // Who did what: audit entries store account IDs; show people's names.
  // All staff are loaded; patients only within the loaded window (others
  // fall back to a short ID).
  const actorNames = useMemo(() => {
    const m = new Map();
    patientUsers.forEach((u) => m.set(u.id, { name: u.name, role: "patient" }));
    staffUsers.forEach((u) => m.set(u.id, { name: u.name, role: u.role }));
    return m;
  }, [staffUsers, patientUsers]);

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

  // Resolve true/false so the bookings table can show "Scheduling…" on the
  // row until the server answers (errors still show in the banner).
  const handleSchedule = ({ bookingId, doctorUid, scheduledTime }) =>
    callAdmin("scheduleConsultation", { bookingId, doctorUid, scheduledTime }).then(
      () => true,
      () => false,
    );

  const handleReschedule = (payload) =>
    callAdmin("rescheduleConsultation", payload).then(
      () => true,
      () => false,
    );

  // close: true closes a held no-show now (details deleted).
  const handleMarkDone = (booking, outcome, close = false) =>
    quietly(
      callAdmin("markConsultationDone", {
        consultationId: booking.consultationId,
        outcome,
        ...(close ? { close: true } : {}),
      }),
    );

  // The doctor can't make it: the patient is emailed and the booking moves
  // to Reschedule requests (the live bookings list shows it).
  const handleDoctorUnavailable = (booking) =>
    quietly(callAdmin("reportDoctorUnavailable", { consultationId: booking.consultationId }));

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
  // Doctor authenticator: first-time setup code, or reset (lost phone).
  const handleDoctorAuthenticator = (u, reset) =>
    callAdmin("resetStaffAuthenticator", { uid: u.id, reset });
  const handleDeactivateUser = (u) =>
    quietly(callAdmin("setAccountStatus", { uid: u.id, status: "deactivated" }));
  const handleReactivateUser = (u) =>
    quietly(callAdmin("setAccountStatus", { uid: u.id, status: "active" }));

  const toSchedule = useMemo(
    () => bookings.filter((b) => b.status === "paid" && !b.consultationId),
    [bookings],
  );

  const stats = useMemo(() => {
    const todaysBookings = bookingLogToday.length;
    const activeConsultations = bookings.filter(
      (b) => b.status === "scheduled" && b.callStartedAt,
    ).length;
    // On duty = has something scheduled today (hospital time): a scheduled
    // consultation, a paid booking for a slot today, or an admin-created
    // slot today that isn't cancelled.
    const onDuty = new Set();
    for (const b of bookings) {
      if (b.status === "scheduled" && b.scheduledTime && hospitalDay(b.scheduledTime) === todayDate) {
        onDuty.add(b.doctorUid);
      }
      if (b.status === "paid" && b.preferredTime && hospitalDay(b.preferredTime) === todayDate) {
        onDuty.add(b.requestedDoctorUid);
      }
    }
    for (const s of todaySlots) {
      if (s.status !== "cancelled") onDuty.add(s.doctorUid);
    }
    onDuty.delete(undefined);
    onDuty.delete(null);
    return {
      todaysBookings,
      activeConsultations,
      doctorsOnDuty: onDuty.size,
    };
  }, [bookings, todaySlots, todayDate, bookingLogToday]);

  const heading = TAB_TITLES[tab] ?? TAB_TITLES.overview;

  return (
    <div className="admin-shell">
      <Sidebar
        active={tab}
        onChange={setTab}
        admin={currentAdmin}
        badges={{ bookings: toSchedule.length, revenue: refundsToHandle }}
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
              {new Date().toLocaleDateString("en-GB", {
                timeZone: "Africa/Accra",
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
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
              names={actorNames}
            />
          )}

          {tab === "bookings" && (
            <BookingsPanel
              bookings={bookings}
              doctors={doctors}
              slots={slots}
              loading={bookingsLoading}
              window={bookingsWin}
              onSchedule={handleSchedule}
              onReschedule={handleReschedule}
              onMarkDone={handleMarkDone}
              onDoctorUnavailable={handleDoctorUnavailable}
              onCreateSlot={handleCreateSlot}
              onCancelSlot={handleCancelSlot}
            />
          )}

          {tab === "history" && <HistoryPanel history={history} window={historyWin} />}

          {tab === "users" && (
            <Users
              users={users}
              patientsWindow={patientsWin}
              currentAdminId={currentAdmin.uid}
              onCreateDoctor={handleCreateDoctor}
              onDoctorAuthenticator={handleDoctorAuthenticator}
              onDeactivate={handleDeactivateUser}
              onReactivate={handleReactivateUser}
            />
          )}

          {tab === "recordings" && <RecordingsPanel callAdmin={callAdmin} />}

          {tab === "revenue" && (
            <>
              <RefundRequestsPanel callAdmin={callAdmin} />
              <PaymentIssuesPanel callAdmin={callAdmin} />
              <RevenuePanel />
            </>
          )}

          {tab === "audit" && <AuditPanel entries={audit} window={auditWin} names={actorNames} />}

          {tab === "metrics" && (
            <MetricsPanel
              weeklyMetrics={weeklyMetrics}
              outcomeBreakdown={outcomeBreakdown}
            />
          )}

          {tab === "control" && <ControlPanel />}

          {tab === "account" && (
            <StaffAccountSettings />
          )}
        </div>
      </main>
    </div>
  );
}

/** YYYY-MM-DD in hospital time (Africa/Accra). */
function hospitalDay(value) {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: "Africa/Accra" });
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
