import Home from "../components/patient/Home";
import BookConsultation from "../components/patient/bookConsultation";
import { Route, Routes } from "react-router-dom";
import Admin from "../components/admin/admin";
import DoctorDashboard from "../components/doctor/doctor";
import Dashboard from "../components/patient/dashboard/patientDashboard";
import { AuthProvider } from "./context/authContext";
import { ProtectedRoute, PublicOnlyRoute } from "./protectedRoutes";
import SignIn from "./pages/auth/signIn";
import SignUp from "./pages/auth/signUp";
import VerifyEmailNotice from "./pages/auth/verifyEmailNotice";
import Unauthorized from "./pages/auth/unauthorized";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Home />} />

        {/* Signed-in users get bounced away from these to their own dashboard */}
        <Route element={<PublicOnlyRoute />}>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
        </Route>

        <Route path="/verify-email" element={<VerifyEmailNotice />} />
        <Route path="/unauthorized" element={<Unauthorized />} />

        {/* Patient-only, and only once their email is verified */}
        <Route
          element={
            <ProtectedRoute allowedRoles={["patient"]} requireVerifiedEmail />
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/book" element={<BookConsultation />} />
        </Route>

       {/*<Route element={<ProtectedRoute allowedRoles={["admin"]} />}>*/}
          <Route path="/admin" element={<Admin />} />
        {/*</Route>*/}

        {/*<Route element={<ProtectedRoute allowedRoles={["doctor"]} />}>*/}
          <Route path="/doctor" element={<DoctorDashboard />} />
       {/* </Route>*/}
      </Routes>
    </AuthProvider>
  );
}
