import Home from "../components/patient/Home";
import BookConsultation from "../components/patient/bookConsultation";
import { Route, Routes } from "react-router-dom";
import Admin from "../components/admin/admin";
import DoctorDashboard from "../components/doctor/doctor";
import Dashboard from "../components/patient/dashboard/dashboard";
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/book" element={<BookConsultation />} />
      <Route path="/dashboard" element={<Dashboard />} />

      <Route path="/admin" element={<Admin />} />

      <Route path="/doctor" element={<DoctorDashboard />} />
    </Routes>
  );
}
