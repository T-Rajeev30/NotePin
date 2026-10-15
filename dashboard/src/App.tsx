import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { LiveProvider } from "./live";
import { ToastProvider } from "./components/ui";
import { Shell } from "./components/Shell";
import { Login } from "./pages/Login";
import { Recordings } from "./pages/Recordings";
import { RecordingView } from "./pages/RecordingView";
import { Devices } from "./pages/Devices";
import { Settings } from "./pages/Settings";

function Gate() {
  const { user } = useAuth();
  if (user === undefined)
    return (
      <div className="boot">
        <span className="led on busy" />
      </div>
    );
  if (!user) return <Login />;
  return (
    <LiveProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<Recordings />}>
            <Route path="r/:id" element={<RecordingView />} />
          </Route>
          <Route path="/devices" element={<Devices />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </LiveProvider>
  );
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ToastProvider>
  );
}
