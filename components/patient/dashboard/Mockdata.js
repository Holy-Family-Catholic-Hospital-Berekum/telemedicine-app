// Mock data standing in for Firestore collections described in the
// architecture doc (Section 5). Replace with real reads once Firestore is
// wired up — see firestoreService.js for exactly which functions to swap.
//
// Deliberately reuses the same doctor/consultation IDs as the doctor
// dashboard's mock data (CID-7X29K4, CID-3Q88T1, Dr. Ama Boateng) so the two
// dashboards read as one connected system rather than two unrelated demos.

// users/{uid} — the logged-in patient.
export const currentPatient = {
  uid: 'pat_kwame_asante',
  name: 'Kwame Asante',
  phone: '+233 24 111 2222',
  email: 'kwame.asante@example.com',
  emailVerified: true,
};

// Fixed consultation fees. In production this presumably lives in a
// Cloud Functions config value or a small `pricing` doc, same spirit as
// FORFEIT_PERCENTAGE on the doctor/admin side — never hardcoded twice.
export const PRICING = {
  'General OPD': 150,
  Surgical: 350,
};

// Where the patient sends the MoMo transfer. Real value would come from
// hospital config, not be hardcoded in the client bundle.
export const HOSPITAL_MOMO = {
  merchantName: 'Holy Family Catholic Hospital',
  network: 'MTN MoMo',
  merchantNumber: '024 000 1234',
};

// bookings, joined here with the matching referenceLedger state for
// convenience. In Firestore these are separate documents/collections
// (see firestoreService.js for the real shape).
//
// state: 'awaiting_payment' | 'pending_verification' | 'scheduled'
export const mockBookings = [
  {
    bookingId: 'bk_2001',
    referenceCode: 'REF-7Q2K9',
    type: 'General OPD',
    mode: 'online',
    amount: PRICING['General OPD'],
    state: 'awaiting_payment',
    expiresAt: new Date(Date.now() + 2.5 * 60 * 60 * 1000).toISOString(),
  },
  {
    bookingId: 'bk_2002',
    referenceCode: 'REF-4M1P0',
    type: 'Surgical',
    mode: 'in person',
    amount: PRICING.Surgical,
    state: 'pending_verification',
    momoName: 'Kwame Asante',
    momoReference: '0099441122',
    submittedAt: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
  },
  {
    bookingId: 'bk_1001',
    referenceCode: 'REF-9X31L',
    type: 'General OPD',
    mode: 'online',
    amount: PRICING['General OPD'],
    state: 'scheduled',
    consultationId: 'CID-7X29K4',
    doctorName: 'Dr. Ama Boateng',
    department: 'General OPD & Surgical',
    scheduledTime: '2026-09-17T10:30:00',
    callStartedAt: null,
  },
  {
    bookingId: 'bk_1003',
    referenceCode: 'REF-3B77H',
    type: 'General OPD',
    mode: 'in person',
    amount: PRICING['General OPD'],
    state: 'scheduled',
    consultationId: 'CID-3Q88T1',
    doctorName: 'Dr. Ama Boateng',
    department: 'General OPD & Surgical',
    scheduledTime: '2026-09-17T14:00:00',
    callStartedAt: null,
  },
];

// availableSlots — open slots a patient can claim directly (4.8).
export const mockAvailableSlots = [
  {
    slotId: 'slot_5501',
    doctorName: 'Dr. Kojo Antwi',
    department: 'Surgical',
    type: 'Surgical',
    mode: 'online',
    date: '2026-09-19',
    startTime: '09:00',
    endTime: '09:30',
  },
  {
    slotId: 'slot_5502',
    doctorName: 'Dr. Ama Boateng',
    department: 'General OPD & Surgical',
    type: 'General OPD',
    mode: 'online',
    date: '2026-09-19',
    startTime: '15:00',
    endTime: '15:30',
  },
  {
    slotId: 'slot_5503',
    doctorName: 'Dr. Naa Odai',
    department: 'General OPD',
    type: 'General OPD',
    mode: 'in person',
    date: '2026-09-20',
    startTime: '10:00',
    endTime: '10:30',
  },
];