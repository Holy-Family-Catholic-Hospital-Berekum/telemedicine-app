import Home from "../components/patient/Home";
import BookConsultation from "../components/patient/bookConsultation";
import { Route, Routes } from "react-router-dom";
import Admin from "../components/admin/admin";
import DoctorDashboard from "../components/doctor/doctor";
import Dashboard from "../components/patient/dashboard/patientDashboard";
import { AuthProvider } from "./context/authContext";
import { ProtectedRoute, PublicOnlyRoute } from "./protectedRoutes";
import SignIn from "./pages/auth/signIn";
import StaffSignIn from "./pages/auth/staffSignIn";
import SignUp from "./pages/auth/signUp";
import VerifyEmailNotice from "./pages/auth/verifyEmailNotice";
import Unauthorized from "./pages/auth/unauthorized";
import { STAFF_LOGIN_PATH } from "./staffRoute";

// Larger, easier-to-read type on every page patients use (src/index.css).
function PatientPage({ children }) {
  return <div className="patient-ui">{children}</div>;
}
import Privacy from "./pages/privacy";
import Terms from "./pages/terms";

// Where signed-out staff are sent: the hidden staff sign-in page.
const STAFF_HOME = STAFF_LOGIN_PATH || "/";

export default function App() {
  return (
    <AuthProvider>
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
    </AuthProvider>
  );
}
