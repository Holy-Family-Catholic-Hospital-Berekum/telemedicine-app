import Home from "../components/patient/Home";
import BookConsultation from "../components/patient/bookConsultation";
import { Route, Routes } from "react-router-dom";
import Admin from "../components/admin/admin";
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/book" element={<BookConsultation />} />

      <Route path="/admin" element={<Admin />} />
    </Routes>
  );
}
