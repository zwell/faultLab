import { Navigate, Route, Routes } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Scenario from "./pages/Scenario.jsx";

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/scenario/:id" element={<Scenario />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
