// mockAdminData.js
//
// Shaped to match the Firestore collections in Section 5 of the architecture
// doc. Swap each export for a live query (onSnapshot) when wiring up — the
// shapes are designed to match 1:1 so the components shouldn't need to change.
//
// Note on data minimisation: consultationHistory and confirmedPayments carry
// NO patient identifiers. They survive session-close erasure, so they must
// never be able to reconstruct who was seen.

export const CONSULTATION_TYPES = ["General OPD", "Surgical"];
export const CONSULTATION_MODES = ["Online", "In person"];

export const consultationFees = {
  "General OPD": 120,
  Surgical: 180,
};

export const doctors = [
  { id: "doc-001", name: "Dr. Abena Owusu", department: "General OPD", available: true },
  { id: "doc-002", name: "Dr. Kwame Asante", department: "Surgical", available: true },
  { id: "doc-003", name: "Dr. Efua Mensah", department: "General OPD", available: false },
  { id: "doc-004", name: "Dr. Samuel Tetteh", department: "Surgical", available: true },
];

export const bookings = [
  {
    bookingId: "BK-48213", patientName: "Yaw Boateng", phone: "+233 24 555 0132",
    type: "General OPD", mode: "Online", paymentStatus: "paid",
    referenceCode: "HFH-7T2K9", amountPaid: 120,
    confirmedBy: "admin-ama", confirmedAt: "2026-09-16T08:12:00Z",
    consultationId: null, scheduledTime: null, doctorId: null,
    callStartedAt: null, rescheduleRequested: false,
  },
  {
    bookingId: "BK-48214", patientName: "Grace Ofori", phone: "+233 20 111 4487",
    type: "Surgical", mode: "In person", paymentStatus: "paid",
    referenceCode: "HFH-3M8QZ", amountPaid: 180,
    confirmedBy: "admin-ama", confirmedAt: "2026-09-16T08:40:00Z",
    consultationId: "CID-99213-XJ", scheduledTime: "2026-09-16T09:30:00Z",
    doctorId: "doc-002", callStartedAt: null, rescheduleRequested: false,
  },
  {
    bookingId: "BK-48215", patientName: "Kofi Ansah", phone: "+233 27 998 2310",
    type: "General OPD", mode: "Online", paymentStatus: "paid",
    referenceCode: "HFH-9K1LR", amountPaid: 120,
    confirmedBy: "admin-samuel", confirmedAt: "2026-09-15T14:02:00Z",
    consultationId: "CID-88110-QW", scheduledTime: "2026-09-16T15:00:00Z",
    doctorId: "doc-001", callStartedAt: "2026-09-16T15:04:00Z", rescheduleRequested: true,
  },
  {
    bookingId: "BK-48216", patientName: "Abigail Asamoah", phone: "+233 55 220 7761",
    type: "Surgical", mode: "In person", paymentStatus: "paid",
    referenceCode: "HFH-5P4TN", amountPaid: 180,
    confirmedBy: "admin-ama", confirmedAt: "2026-09-16T09:05:00Z",
    consultationId: "CID-77004-LM", scheduledTime: "2026-09-16T11:00:00Z",
    doctorId: "doc-004", callStartedAt: null, rescheduleRequested: false,
  },
];

// referenceLedger entries in the pending state. The admin dashboard
// deliberately does NOT display momoName / momoReference / amount before
// verification — see PaymentVerificationModal.jsx.
export const pendingReferenceClaims = [
  {
    referenceCode: "HFH-2Q7VD", state: "pending", claimedByUid: "uid-3391",
    patientName: "Nana Adjei", type: "General OPD", mode: "Online",
    phone: "+233 24 300 1188",
    momoName: "Nana K. Adjei", momoReference: "MP240916.0912.A55213",
    amount: 120, claimedAt: "2026-09-16T09:12:40Z",
  },
  {
    referenceCode: "HFH-8Y3XC", state: "pending", claimedByUid: "uid-5502",
    patientName: "Esi Bonsu", type: "Surgical", mode: "In person",
    phone: "+233 20 774 9021",
    momoName: "Esi Bonsu", momoReference: "MP240916.0955.B10982",
    amount: 180, claimedAt: "2026-09-16T09:55:11Z",
  },
];

export const ledgerCounts = { available: 214, pending: pendingReferenceClaims.length, confirmed: 1832 };

// Open doctor availability slots created by admin. A patient can book a
// specific slot (doctor + time pre-assigned) instead of the general flow
// (pay first, admin assigns a doctor and time afterwards). A slot moves to
// "booked" once a patient claims it; "open" slots are cancellable by admin.
export const availableSlots = [
  {
    id: "SLOT-1001", doctorId: "doc-001", type: "General OPD", mode: "Online",
    date: "2026-09-18", startTime: "09:00", endTime: "09:30",
    status: "open", createdBy: "admin-ama", createdAt: "2026-09-16T08:00:00Z",
  },
  {
    id: "SLOT-1002", doctorId: "doc-001", type: "General OPD", mode: "Online",
    date: "2026-09-18", startTime: "09:30", endTime: "10:00",
    status: "booked", createdBy: "admin-ama", createdAt: "2026-09-16T08:00:00Z",
  },
  {
    id: "SLOT-1003", doctorId: "doc-002", type: "Surgical", mode: "In person",
    date: "2026-09-19", startTime: "13:00", endTime: "13:45",
    status: "open", createdBy: "admin-samuel", createdAt: "2026-09-16T09:30:00Z",
  },
];

export const activityEvents = [
  { id: "act-1", type: "blocked_duplicate", referenceCode: "HFH-9K1LR", account: "uid-7743", timestamp: "2026-09-16T10:02:07Z" },
  { id: "act-2", type: "confirmed", referenceCode: "HFH-7T2K9", account: "admin-ama", timestamp: "2026-09-16T08:12:00Z" },
  { id: "act-3", type: "rejected", referenceCode: "HFH-1L0AA", account: "admin-samuel", timestamp: "2026-09-16T07:48:22Z" },
  { id: "act-4", type: "confirmed", referenceCode: "HFH-3M8QZ", account: "admin-ama", timestamp: "2026-09-16T08:40:00Z" },
  { id: "act-5", type: "blocked_duplicate", referenceCode: "HFH-3M8QZ", account: "uid-2201", timestamp: "2026-09-16T08:41:15Z" },
  { id: "act-6", type: "mismatch", referenceCode: "HFH-8Y3XC", account: "admin-samuel", timestamp: "2026-09-16T10:14:33Z" },
];

export const auditLogEntries = [
  { id: "aud-1", actorId: "admin-ama", action: "Confirmed payment", targetId: "BK-48213", timestamp: "2026-09-16T08:12:00Z" },
  { id: "aud-2", actorId: "admin-ama", action: "Scheduled consultation", targetId: "BK-48214", timestamp: "2026-09-16T08:41:00Z" },
  { id: "aud-3", actorId: "doc-002", action: "Closed session", targetId: "BK-48109", timestamp: "2026-09-15T16:20:00Z" },
  { id: "aud-4", actorId: "admin-samuel", action: "Rejected reference code", targetId: "HFH-1L0AA", timestamp: "2026-09-16T07:48:22Z" },
  { id: "aud-5", actorId: "admin-samuel", action: "Verification mismatch", targetId: "HFH-8Y3XC", timestamp: "2026-09-16T10:14:33Z" },
];

// Permanent. No patient identifiers — survives session-close erasure.
export const confirmedPayments = [
  { id: "pay-1", referenceCode: "HFH-7T2K9", type: "General OPD", amount: 120, confirmedBy: "admin-ama", confirmedAt: "2026-09-16T08:12:00Z" },
  { id: "pay-2", referenceCode: "HFH-3M8QZ", type: "Surgical", amount: 180, confirmedBy: "admin-ama", confirmedAt: "2026-09-16T08:40:00Z" },
  { id: "pay-3", referenceCode: "HFH-5P4TN", type: "Surgical", amount: 180, confirmedBy: "admin-ama", confirmedAt: "2026-09-16T09:05:00Z" },
  { id: "pay-4", referenceCode: "HFH-9K1LR", type: "General OPD", amount: 120, confirmedBy: "admin-samuel", confirmedAt: "2026-09-15T14:02:00Z" },
  { id: "pay-5", referenceCode: "HFH-4R2BB", type: "General OPD", amount: 120, confirmedBy: "admin-samuel", confirmedAt: "2026-09-15T11:30:00Z" },
  { id: "pay-6", referenceCode: "HFH-6W8DD", type: "Surgical", amount: 180, confirmedBy: "admin-ama", confirmedAt: "2026-09-14T10:15:00Z" },
];

// Permanent, anonymised. Matches the metrics collection shape.
export const consultationHistory = [
  { id: "hist-1", consultationId: "CID-88012-AA", type: "General OPD", mode: "Online", doctorOrDept: "Dr. Abena Owusu", startedAt: "2026-09-15T09:04:00Z", endedAt: "2026-09-15T09:31:00Z", outcome: "Completed" },
  { id: "hist-2", consultationId: "CID-88044-BB", type: "Surgical", mode: "In person", doctorOrDept: "Dr. Kwame Asante", startedAt: "2026-09-15T11:00:00Z", endedAt: "2026-09-15T11:48:00Z", outcome: "Completed" },
  { id: "hist-3", consultationId: "CID-88109-CC", type: "General OPD", mode: "Online", doctorOrDept: "Dr. Efua Mensah", startedAt: "2026-09-15T14:10:00Z", endedAt: "2026-09-15T14:22:00Z", outcome: "Completed" },
  { id: "hist-4", consultationId: "CID-87990-DD", type: "Surgical", mode: "In person", doctorOrDept: "Dr. Samuel Tetteh", startedAt: "2026-09-14T15:30:00Z", endedAt: "2026-09-14T16:05:00Z", outcome: "Completed" },
  { id: "hist-5", consultationId: "CID-87931-EE", type: "General OPD", mode: "Online", doctorOrDept: "Dr. Abena Owusu", startedAt: "2026-09-14T08:00:00Z", endedAt: "2026-09-14T08:06:00Z", outcome: "No-show" },
];

export const weeklyMetrics = [
  { day: "Mon", opd: 14, surgical: 5 },
  { day: "Tue", opd: 18, surgical: 6 },
  { day: "Wed", opd: 12, surgical: 4 },
  { day: "Thu", opd: 21, surgical: 8 },
  { day: "Fri", opd: 25, surgical: 9 },
  { day: "Sat", opd: 10, surgical: 3 },
  { day: "Sun", opd: 6, surgical: 1 },
];

export const outcomeBreakdown = [
  { label: "Completed", value: 168, color: "var(--color-secondary)" },
  { label: "No-show", value: 14, color: "var(--color-warning)" },
  { label: "Rescheduled", value: 9, color: "var(--color-primary)" },
];

export const overviewStats = {
  pendingPayments: pendingReferenceClaims.length,
  todaysBookings: 7,
  activeConsultations: 2,
  doctorsOnDuty: doctors.filter((d) => d.available).length,
};
