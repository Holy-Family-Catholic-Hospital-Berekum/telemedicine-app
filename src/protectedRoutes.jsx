// protectedRoutes.jsx
//
// React Router v6 route guards. Two exports:
//
//   <ProtectedRoute>   — requires sign-in, optionally a role, optionally
//                         a verified email. Wraps its children with
//                         <Outlet/> for nested routes.
//   <PublicOnlyRoute>  — the inverse: bounces an already-signed-in user
//                         away from /signin and /signup to their dashboard.
//
// IMPORTANT: these are UX guards, not your security boundary. A patient
// blocked here from /admin could still, in principle, hand-craft a
// request straight to Firestore — what actually stops that is your
// Firestore Security Rules checking adminUsers server-side (6.1 in the
// architecture doc). Keep this file and your Security Rules in sync,
// and treat the rules as the source of truth.
//
// Example wiring in your router:
//
//   <Routes>
//     <Route element={<PublicOnlyRoute />}>
//       <Route path="/signin" element={<SignIn />} />
//       <Route path="/signup" element={<SignUp />} />
//     </Route>
//
//     <Route path="/verify-email" element={<VerifyEmailNotice />} />
//     <Route path="/unauthorized" element={<Unauthorized />} />
//
//     <Route element={<ProtectedRoute allowedRoles={["patient"]} requireVerifiedEmail />}>
//       <Route path="/dashboard" element={<PatientDashboard />} />
//       <Route path="/book" element={<BookingFlow />} />
//     </Route>
//
//     <Route element={<ProtectedRoute allowedRoles={["admin"]} />}>
//       <Route path="/admin" element={<AdminDashboard />} />
//     </Route>
//
//     <Route element={<ProtectedRoute allowedRoles={["doctor"]} />}>
//       <Route path="/doctor" element={<DoctorDashboard />} />
//     </Route>
//   </Routes>

import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./context/authContext.jsx";
import HealthcarePreloader from "./components/common/healthcarePreloader.jsx";
import { OfflineScreen } from "../components/shared/offlineScreen.jsx";

const ROLE_HOME = { patient: "/dashboard", admin: "/admin", doctor: "/doctor" };

export function ProtectedRoute({ allowedRoles, requireVerifiedEmail = false, redirectTo = "/signin" }) {
  const { user, role, emailVerified, initializing, connectionProblem } = useAuth();
  const location = useLocation();

  if (initializing) {
    return <HealthcarePreloader fullscreen label="Checking your session…" />;
  }

  if (!user) {
    return <Navigate to={redirectTo} replace state={{ from: location }} />;
  }

  // Signed in, but the account couldn't be checked without a connection:
  // say so (and reload when it's back) instead of "unauthorized". Still no
  // access until the check succeeds.
  if (!role && connectionProblem) {
    return (
      <OfflineScreen
        title="You're offline"
        message="Connect to the internet to see your appointments. This page will reload by itself when you're back online."
      />
    );
  }

  // Only patients are gated on email verification — staff accounts are
  // provisioned directly by the hospital (4.1).
  if (requireVerifiedEmail && role === "patient" && !emailVerified) {
    return <Navigate to="/verify-email" replace />;
  }

  // Fail closed: a signed-in user with no role (no claim, deactivated, or
  // a profile that couldn't load) gets no protected page.
  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}

export function PublicOnlyRoute({ redirectTo }) {
  const { user, role, initializing } = useAuth();

  if (initializing) {
    return <HealthcarePreloader fullscreen label="Loading…" />;
  }

  if (user) {
    return <Navigate to={redirectTo || ROLE_HOME[role] || "/"} replace />;
  }

  return <Outlet />;
}
