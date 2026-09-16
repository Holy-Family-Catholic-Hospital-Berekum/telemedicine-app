import Home from "../components/patient/Home";
import BookConsultation from "../components/patient/bookConsultation";
import { Route, Routes } from "react-router-dom";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/book" element={<BookConsultation />} />
    </Routes>
  );
}
