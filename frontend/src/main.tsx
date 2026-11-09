import React from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import {
  Activity,
  CircleHelp,
  FlaskConical,
  Layers3,
  ShieldCheck,
} from "lucide-react";
import { Monitor } from "./pages/Monitor";
import { Simulator } from "./pages/Simulator";
import "./styles.css";

function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <aside className="sidebar">
          <NavLink to="/monitor" className="brand">
            <span className="brand-mark">
              <Layers3 size={23} />
            </span>
            ledger<span className="brand-dot">.</span>
          </NavLink>
          <div className="workspace">
            <span className="workspace-icon">FM</span>
            <div>
              Financial workspace<small>Development environment</small>
            </div>
            <span className="workspace-chevron">⌄</span>
          </div>
          <p className="nav-label">WORKSPACE</p>
          <nav>
            <NavLink to="/monitor">
              <Activity size={18} />
              Live monitor
              <span className="nav-live" />
            </NavLink>
            <NavLink to="/add">
              <FlaskConical size={18} />
              Transaction simulator
            </NavLink>
          </nav>
          <div className="sidebar-bottom">
            <div className="environment">
              <span className="dot" />
              Local environment<small>Built for real-time visibility.</small>
            </div>
            <div className="profile">
              <span>SA</span>
              <div>
                Support agent<small>Operations team</small>
              </div>
              <ShieldCheck size={17} />
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div>
              Workspace <span>/</span> Financial monitor
            </div>
            <div className="topbar-right">
              <span className="version">MVP / v1.0</span>
              <CircleHelp size={18} />
              <span className="avatar">SA</span>
            </div>
          </header>
          <Routes>
            <Route path="/monitor" element={<Monitor />} />
            <Route path="/add" element={<Simulator />} />
            <Route path="*" element={<Navigate to="/monitor" replace />} />
          </Routes>
          <footer>
            <span>
              <Layers3 size={13} /> Ledger Financial Monitor
            </span>
            <span>Clarity in every transaction.</span>
          </footer>
        </div>
      </div>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
