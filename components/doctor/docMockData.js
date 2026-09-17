// Mock data standing in for Firestore collections described in the
// architecture doc (Section 5). Replace with real reads once Firestore is
// wired up — see firestoreService.js for exactly which functions to swap.
//
// Note on `amountPaid`: doctors never see money in this app (payment is an
// admin/reception concern per 4.4). It's kept here only because the
// server-side forfeit calculation in markConsultationDone() needs it —
// no doctor-facing component reads this field.

export const currentDoctor = {
  uid: "doc_ama_boateng",
  name: "Dr. Ama Boateng",
  department: "General OPD & Surgical",
  role: "doctor",
  mfaEnabled: true,
};

// Hospital-configured forfeit percentage for No-show outcomes (4.9).
// Stored as a Cloud Functions config value in production, not hardcoded.
export const FORFEIT_PERCENTAGE = 0.2;

// Public-facing profile content the doctor manages themselves, shown in the
// "Meet your doctors" section of the patient-facing landing page. This is
// intentionally a separate mock object from `currentDoctor` above:
// `currentDoctor` is identity/session state (who's logged in, MFA status),
// while this is editable public content — closer in spirit to `bookings`
// than to `adminUsers`. It should live in its own `doctorProfiles`
// collection, not be bolted onto `currentDoctor`, so that a future
// "adminUsers can also edit a doctor's public bio" feature doesn't need to
// touch anything session-related. See firestoreService.js for the read/
// write functions and the access-rule notes.
export const mockDoctorProfile = {
  doctorId: "doc_ama_boateng",
  photoURL: null,
  title: "MBChB, FWACS (General Surgery)",
  yearsExperience: 9,
  languages: ["English", "Twi"],
  specialties: ["General Surgery", "Laparoscopic Procedures", "Wound Care"],
  bio: "Dr. Boateng has practised general and surgical medicine at Holy Family since 2017, with a particular interest in minimally invasive procedures and post-operative recovery.",
  updatedAt: "2026-08-02T10:00:00",
};

// consultations assigned to doc_ama_boateng. In Firestore these fields live
// across three collections/documents (see firestoreService.js) — joined
// here just for convenience in the mock.
export const mockConsultations = [
  {
    consultationId: "CID-9M12P7",
    bookingId: "bk_1002",
    doctorId: "doc_ama_boateng",
    type: "Surgical",
    mode: "online",
    scheduledTime: "2026-09-17T09:00:00",
    status: "active",
    callStartedAt: "2026-09-17T09:04:00",
    amountPaid: 350,
    patient: { name: "Efua Mensah", location: "Cantonments, Accra" },
    sensitiveDetails: { dateOfBirth: "1985-11-02", sex: "Female" },
    rescheduleHistory: [],
  },
  {
    consultationId: "CID-7X29K4",
    bookingId: "bk_1001",
    doctorId: "doc_ama_boateng",
    type: "General OPD",
    mode: "online",
    scheduledTime: "2026-09-17T10:30:00",
    status: "active",
    callStartedAt: null,
    amountPaid: 150,
    patient: { name: "Kwame Asante", location: "Adenta, Accra" },
    sensitiveDetails: { dateOfBirth: "1990-04-12", sex: "Male" },
    rescheduleHistory: [],
  },
  {
    consultationId: "CID-3Q88T1",
    bookingId: "bk_1003",
    doctorId: "doc_ama_boateng",
    type: "General OPD",
    mode: "in person",
    scheduledTime: "2026-09-17T14:00:00",
    status: "active",
    callStartedAt: null,
    amountPaid: 150,
    patient: { name: "Yaw Owusu", location: "East Legon, Accra" },
    sensitiveDetails: { dateOfBirth: "2001-01-20", sex: "Male" },
    rescheduleHistory: [
      {
        from: "2026-09-16T14:00:00",
        to: "2026-09-17T14:00:00",
        reason: "Patient request",
      },
    ],
  },
  {
    consultationId: "CID-5R44Z9",
    bookingId: "bk_1004",
    doctorId: "doc_ama_boateng",
    type: "Surgical",
    mode: "online",
    scheduledTime: "2026-09-18T11:00:00",
    status: "active",
    callStartedAt: null,
    amountPaid: 350,
    patient: { name: "Abena Darko", location: "Tema, Greater Accra" },
    sensitiveDetails: { dateOfBirth: "1978-06-30", sex: "Female" },
    rescheduleHistory: [],
  },
];
