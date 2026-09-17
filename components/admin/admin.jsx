import { useMemo, useState } from "react";

import Sidebar from "./sidebar.jsx";
import OverviewPanel from "./overviewPanel.jsx";
import BookingsPanel from "./bookingsPanel.jsx";
import PaymentsPanel from "./paymentsPanel.jsx";
import HistoryPanel from "./historyPanel.jsx";
import RevenuePanel from "./revenuePanel.jsx";
import ActivityPanel from "./activityPanel.jsx";
import AuditPanel from "./auditPanel.jsx";
import MetricsPanel from "./metricsPanel.jsx";
import { IconBell, IconRefresh } from "./icons.jsx";

import {
  doctors as seedDoctors,
  bookings as seedBookings,
  pendingReferenceClaims as seedClaims,
  ledgerCounts as seedLedgerCounts,
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
    title: "Bookings & scheduling",
    sub: "Assign a doctor and time slot to paid bookings",
  },
  payments: {
    title: "Payments & reference codes",
    sub: "Verify mobile money transfers against the hospital statement",
  },
  history: {
    title: "Consultation history",
    sub: "When sessions ran and how they ended",
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
let paymentSeq = 100;
let historySeq = 100;
let slotSeq = 1004;

export default function Admin({ onLogout = () => {} }) {
  const [tab, setTab] = useState("overview");

  // Local state stands in for Firestore onSnapshot subscriptions. Each setter
  // below is the point where you'd instead call a Cloud Function and let the
  // snapshot listener update the UI.
  const [doctors] = useState(seedDoctors);
  const [bookings, setBookings] = useState(seedBookings);
  const [claims, setClaims] = useState(seedClaims);
  const [ledger, setLedger] = useState(seedLedgerCounts);
  const [activity, setActivity] = useState(seedActivity);
  const [audit, setAudit] = useState(seedAudit);
  const [payments, setPayments] = useState(seedPayments);
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

  // 4.3 Payment Service. The verification modal has already matched the
  // admin's reading of the MoMo SMS against the patient's submission — that
  // comparison must move into the confirmPayment Cloud Function before launch.
  const handleConfirmPayment = (claim, extra = {}) => {
    setClaims((prev) =>
      prev.filter((c) => c.referenceCode !== claim.referenceCode),
    );
    setLedger((prev) => ({
      ...prev,
      pending: Math.max(0, prev.pending - 1),
      confirmed: prev.confirmed + 1,
    }));
    setBookings((prev) => [
      {
        bookingId: `BK-${Math.floor(48000 + Math.random() * 999)}`,
        patientName: claim.patientName,
        phone: claim.phone ?? "—",
        type: claim.type,
        mode: claim.mode,
        paymentStatus: "paid",
        referenceCode: claim.referenceCode,
        amountPaid: claim.amount,
        confirmedBy: CURRENT_ADMIN.uid,
        confirmedAt: new Date().toISOString(),
        consultationId: null,
        scheduledTime: null,
        doctorId: null,
        callStartedAt: null,
        rescheduleRequested: false,
      },
      ...prev,
    ]);
    // Permanent, anonymised — survives session-close erasure.
    setPayments((prev) => [
      {
        id: `pay-${paymentSeq++}`,
        referenceCode: claim.referenceCode,
        type: claim.type,
        amount: claim.amount,
        confirmedBy: CURRENT_ADMIN.uid,
        confirmedAt: new Date().toISOString(),
        transactionId: extra.transactionId ?? null,
      },
      ...prev,
    ]);
    pushActivity("confirmed", claim.referenceCode);
    pushAudit("Confirmed payment", claim.referenceCode);
  };

  // A rejection releases the code back to available, so a mistaken submission
  // never permanently locks out the real payer.
  const handleRejectPayment = (claim) => {
    setClaims((prev) =>
      prev.filter((c) => c.referenceCode !== claim.referenceCode),
    );
    setLedger((prev) => ({
      ...prev,
      pending: Math.max(0, prev.pending - 1),
      available: prev.available + 1,
    }));
    pushActivity("rejected", claim.referenceCode);
    pushAudit("Rejected reference code", claim.referenceCode);
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
  const handleCreateSlot = ({ doctorId, type, mode, date, startTime, endTime }) => {
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

  const stats = useMemo(
    () => ({
      ...seedStats,
      pendingPayments: claims.length,
      doctorsOnDuty: doctors.filter((d) => d.available).length,
    }),
    [claims.length, doctors],
  );

  const heading = TAB_TITLES[tab];

  return (
    <div className="admin-shell">
      <Sidebar
        active={tab}
        onChange={setTab}
        admin={CURRENT_ADMIN}
        pendingCount={claims.length}
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
              {claims.length > 0 && <span className="dot" />}
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

          {tab === "payments" && (
            <PaymentsPanel
              claims={claims}
              ledger={ledger}
              onConfirm={handleConfirmPayment}
              onReject={handleRejectPayment}
            />
          )}

          {tab === "history" && <HistoryPanel history={history} />}

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
