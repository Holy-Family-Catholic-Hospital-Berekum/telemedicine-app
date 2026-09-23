// MOCK DATA — doctor directory shown in "Meet your doctors" (Home.jsx) and
// in the "Choose your doctor" picker on the booking page
// (bookConsultation.jsx). Replace with a Firestore `doctorProfiles` read
// later — see the read/write notes in firestoreService.js. Keep this shape
// (id, tier, specialties, availableFor) since both pages depend on it.
//
// `tier`: "general" | "specialist" — drives the consultation fee, see
// src/data/consultationFees.js.
// `availableFor`: which consultation type(s) ("OPD" | "SURGICAL") this
// doctor takes, so the picker hides doctors who don't do that type.
// `image`: public/doctors/*.jpg. Missing files degrade to an initials tile
// (see DoctorPortrait in Home.jsx), they don't break the page.
import doc1 from "../../images/doctors/doc1.jpg";
import doc2 from "../../images/doctors/doc2.jpg";
import doc3 from "../../images/doctors/doc3.jpg";
import doc4 from "../../images/doctors/doc4.jpg";

const doctors = [
  {
    id: "doc_ama_boateng",
    name: "Dr. Ama Boateng",
    role: "General Surgeon",
    tier: "specialist",
    availableFor: ["OPD", "SURGICAL"],
    specialties: ["General Surgery", "Laparoscopic Procedures", "Wound Care"],
    focus: "Minimally invasive procedures and post-operative recovery.",
    availability: "Available today",
    initials: "AB",
    image: doc1,
    languages: ["English", "Twi"],
  },
  {
    id: "doc_kojo_mensah",
    name: "Dr. Kojo Mensah",
    role: "General Practitioner",
    tier: "general",
    availableFor: ["OPD"],
    specialties: ["Family Medicine", "Diabetes & Hypertension", "Child Welfare"],
    focus: "Everyday health concerns, check-ups and chronic condition follow-ups.",
    availability: "Available today",
    initials: "KM",
    image: doc2,
    languages: ["English", "Twi", "Ga"],
  },
  {
    id: "doc_efua_owusu",
    name: "Dr. Efua Owusu",
    role: "Obstetrician & Gynecologist",
    tier: "specialist",
    availableFor: ["OPD", "SURGICAL"],
    specialties: ["Antenatal Care", "Gynecological Surgery", "Family Planning"],
    focus: "Antenatal care through to gynecological surgery and recovery.",
    availability: "Available tomorrow",
    initials: "EO",
    image: doc3,
    languages: ["English", "Twi"],
  },
  {
    id: "doc_yaw_adjei",
    name: "Dr. Yaw Adjei",
    role: "General Practitioner",
    tier: "general",
    availableFor: ["OPD"],
    specialties: ["General Consultation", "Wound Care & Dressing"],
    focus: "Everyday consultations, dressing changes and general check-ups.",
    availability: "Available today",
    initials: "YA",
    image: doc4,
    languages: ["English"],
  },
  {
    id: "doc_abena_asante",
    name: "Dr. Abena Asante",
    role: "Orthopedic Surgeon",
    tier: "specialist",
    availableFor: ["SURGICAL"],
    specialties: ["Orthopedic Surgery", "Post-Surgical Follow-up"],
    focus: "Orthopedic assessments, surgery and post-operative follow-up.",
    availability: "Available Mon–Fri",
    initials: "AA",
    image: "/doctors/abena-asante.jpg",
    languages: ["English", "Twi"],
  },
  {
    id: "doc_kwabena_darko",
    name: "Dr. Kwabena Darko",
    role: "General Practitioner",
    tier: "general",
    availableFor: ["OPD"],
    specialties: ["Family Planning", "Immunization", "General Consultation"],
    focus: "Family planning, immunization and general outpatient care.",
    availability: "Available today",
    initials: "KD",
    image: "/doctors/kwabena-darko.jpg",
    languages: ["English", "Twi"],
  },
];

export default doctors;
