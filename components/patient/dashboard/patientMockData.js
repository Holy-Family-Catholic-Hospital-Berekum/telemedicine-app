// Mock data standing in for Firestore collections described in the
// architecture document.

// Payment:
// A booking only exists after Paystack payment has been successfully
// confirmed by the server.

// Booking states:
// "pending_assignment" → payment completed, but staff have not yet
// assigned a doctor/time.
//
// "scheduled" → doctor and time assigned and consultationId issued.

export const currentPatient = {
  uid: "pat_kwame_asante",
  name: "Kwame Asante",
  phone: "+233 24 111 2222",
  email: "kwame.asante@example.com",
  emailVerified: true,
};

// Fixed consultation fees.
// These are reference values only. A real booking should use the
// server-confirmed amount after Paystack verification.

export const PRICING = {
  "General OPD": 150,
  Surgical: 350,
};

export const mockBookings = [
  {
    bookingId: "bk_2001",
    referenceCode: "REF-7Q2K9",
    type: "General OPD",
    mode: "online",
    amount: PRICING["General OPD"],
    currency: "GHS",
    state: "pending_assignment",
    paidAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  },

  {
    bookingId: "bk_2002",
    referenceCode: "REF-4M1P0",
    type: "Surgical",
    mode: "in person",
    amount: PRICING.Surgical,
    currency: "GHS",
    state: "pending_assignment",
    paidAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  },

  {
    bookingId: "bk_1001",
    referenceCode: "REF-9X31L",
    type: "General OPD",
    mode: "online",
    amount: PRICING["General OPD"],
    currency: "GHS",
    state: "scheduled",
    consultationId: "CID-7X29K4",
    doctorName: "Dr. Ama Boateng",
    department: "General OPD & Surgical",
    scheduledTime: "2026-09-17T10:30:00",
    callStartedAt: null,
  },

  {
    bookingId: "bk_1003",
    referenceCode: "REF-3B77H",
    type: "General OPD",
    mode: "in person",
    amount: PRICING["General OPD"],
    currency: "GHS",
    state: "scheduled",
    consultationId: "CID-3Q88T1",
    doctorName: "Dr. Ama Boateng",
    department: "General OPD & Surgical",
    scheduledTime: "2026-09-17T14:00:00",
    callStartedAt: null,
  },
];

// Available slots that patients can claim directly.

export const mockAvailableSlots = [
  {
    slotId: "slot_5501",
    doctorName: "Dr. Kojo Antwi",
    department: "Surgical",
    type: "Surgical",
    mode: "online",
    date: "2026-09-19",
    startTime: "09:00",
    endTime: "09:30",
  },

  {
    slotId: "slot_5502",
    doctorName: "Dr. Ama Boateng",
    department: "General OPD & Surgical",
    type: "General OPD",
    mode: "online",
    date: "2026-09-19",
    startTime: "15:00",
    endTime: "15:30",
  },

  {
    slotId: "slot_5503",
    doctorName: "Dr. Naa Odai",
    department: "General OPD",
    type: "General OPD",
    mode: "in person",
    date: "2026-09-20",
    startTime: "10:00",
    endTime: "10:30",
  },
];

// Consultation history.
//
// IMPORTANT:
// History deliberately contains only information that survives after
// the consultation is closed:
//
// - doctor
// - consultation start/end time
// - amount paid
//
// Patient booking information such as DOB, sex, location, reason and
// consultation ID does NOT belong here.

export const mockConsultationHistory = [
  {
    id: "ch_9001",
    doctorName: "Dr. Ama Boateng",
    mode: "online",
    startTime: "2026-08-03T10:32:00",
    endTime: "2026-08-03T10:51:00",
    amountPaid: 150,
  },
  {
    id: "ch_9002",
    doctorName: "Dr. Kojo Antwi",
    mode: "in person",
    startTime: "2026-07-22T15:04:00",
    endTime: "2026-07-22T15:29:00",
    amountPaid: 350,
  },
  {
    id: "ch_9003",
    doctorName: "Dr. Naa Odai",
    mode: "online",
    startTime: "2026-06-30T09:01:00",
    endTime: "2026-06-30T09:18:00",
    amountPaid: 150,
  },
];
