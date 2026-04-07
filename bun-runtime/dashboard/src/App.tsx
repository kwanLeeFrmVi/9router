import { useEffect } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./lib/auth.tsx";
import Sidebar from "./components/Sidebar.tsx";
import Login from "./pages/Login.tsx";
import Providers from "./pages/Providers.tsx";
import ApiKeys from "./pages/ApiKeys.tsx";
import Usage from "./pages/Usage.tsx";
import Logs from "./pages/Logs.tsx";
import Models from "./pages/Models.tsx";
import { Loader } from "./components/Loader.tsx";

function ProtectedLayout() {
  const { token, loading } = useAuth();

  if (loading) return <Loader />;
  if (!token) return <Navigate to="/login" replace />;

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6">
        <Routes>
          <Route path="/" element={<Navigate to="/providers" replace />} />
          <Route path="/providers" element={<Providers />} />
          <Route path="/keys" element={<ApiKeys />} />
          <Route path="/usage" element={<Usage />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/models" element={<Models />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  // Redirect root hash to /providers
  useEffect(() => {
    if (window.location.hash === "#" || !window.location.hash) {
      window.location.hash = "#/providers";
    }
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<ProtectedLayout />} />
      </Routes>
    </HashRouter>
  );
}
