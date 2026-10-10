import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import Home from "../components/patient/Home";
import { AuthProvider } from "./context/authContext";
import { ProtectedRoute, PublicOnlyRoute } from "./protectedRoutes";
import { STAFF_LOGIN_PATH } from "./staffRoute";
import HealthcarePreloader from "./components/common/healthcarePreloader.jsx";

// Code splitting: the home page (what most visitors and search engines
// open first) ships in the main bundle; every other page downloads only
// when it's opened, so a patient never downloads the admin dashboard,
// the doctor portal or the video-call code just to see the home page.
const BookConsultation = lazy(() => import("../components/patient/bookConsultation"));
const Admin = lazy(() => import("../components/admin/admin"));
const DoctorDashboard = lazy(() => import("../components/doctor/doctor"));
const Dashboard = lazy(() => import("../components/patient/dashboard/patientDashboard"));
const SignIn = lazy(() => import("./pages/auth/signIn"));
const StaffSignIn = lazy(() => import("./pages/auth/staffSignIn"));
const SignUp = lazy(() => import("./pages/auth/signUp"));
const VerifyEmailNotice = lazy(() => import("./pages/auth/verifyEmailNotice"));
const Unauthorized = lazy(() => import("./pages/auth/unauthorized"));
const Privacy = lazy(() => import("./pages/privacy"));
const Terms = lazy(() => import("./pages/terms"));

// Larger, easier-to-read type on every page patients use (src/index.css).
// Every patient page also gets the WhatsApp "Chat with us" button.
function PatientPage({ children }) {
  return (
    <div className="patient-ui">
      {children}
      <WhatsAppSupport />
    </div>
  );
}
import WhatsAppSupport from "../components/shared/whatsAppSupport";
import NetworkBanner from "../components/shared/networkBanner";
import AppUpdate from "../components/shared/appUpdate";

// Where signed-out staff are sent: the hidden staff sign-in page.
const STAFF_HOME = STAFF_LOGIN_PATH || "/";

export default function App() {
  return (
    <AuthProvider>
      {/* Every page: connection status, and "new version ready". */}
      <NetworkBanner />
      <AppUpdate />
      <Suspense fallback={<HealthcarePreloader fullscreen label="Loading…" />}>
      <Routes>
        <Route path="/" element={<PatientPage><Home /></PatientPage>} />
        <Route path="/privacy" element={<PatientPage><Privacy /></PatientPage>} />
        <Route path="/terms" element={<PatientPage><Terms /></PatientPage>} />

        {/* Signed-in users get bounced away from these to their own dashboard */}
        <Route element={<PublicOnlyRoute />}>
          <Route path="/signin" element={<PatientPage><SignIn audience="patient" /></PatientPage>} />
          <Route path="/signup" element={<PatientPage><SignUp /></PatientPage>} />
          {STAFF_LOGIN_PATH && (
            <Route path={STAFF_LOGIN_PATH} element={<StaffSignIn />} />
          )}
        </Route>

        <Route path="/verify-email" element={<PatientPage><VerifyEmailNotice /></PatientPage>} />
        <Route path="/unauthorized" element={<PatientPage><Unauthorized /></PatientPage>} />

        {/* Patient-only, and only once their email is verified */}
        <Route
          element={
            <ProtectedRoute allowedRoles={["patient"]} requireVerifiedEmail />
          }
        >
          <Route path="/dashboard" element={<PatientPage><Dashboard /></PatientPage>} />
          <Route path="/book" element={<PatientPage><BookConsultation /></PatientPage>} />
        </Route>

        <Route element={<ProtectedRoute allowedRoles={["admin"]} redirectTo={STAFF_HOME} />}>
          <Route path="/admin" element={<Admin />} />
        </Route>

        <Route element={<ProtectedRoute allowedRoles={["doctor"]} redirectTo={STAFF_HOME} />}>
          <Route path="/doctor" element={<DoctorDashboard />} />
        </Route>
      </Routes>
      </Suspense>
    </AuthProvider>
  );
}
