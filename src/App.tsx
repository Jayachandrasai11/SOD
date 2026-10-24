import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import HomePage from "./pages/Home";
import RolesPage from "./pages/roles/RolesPage";
import RoleDetailPage from "./pages/roles/RoleDetailPage";
import AnalysisPage from "./pages/roles/AnalysisPage";
import RoleBuilderPage from "./pages/builder/RoleBuilderPage";
import AuditLogPage from "./pages/AuditLog";
import SettingsPage from "./pages/Settings";
import { EmptyState } from "./components/common";
import { Compass } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "./components/ui/button";

function RedirectToSettings({ defaultTab }: { defaultTab: string }) {
  const [params] = useSearchParams();
  const search = new URLSearchParams(params);
  if (!search.has("tab")) search.set("tab", defaultTab);
  return <Navigate to={`/settings?${search.toString()}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="rules" element={<RedirectToSettings defaultTab="rules" />} />
        <Route path="connections" element={<RedirectToSettings defaultTab="connections" />} />
        <Route path="roles" element={<RolesPage />} />
        <Route path="roles/analysis" element={<AnalysisPage />} />
        <Route path="roles/:name" element={<RoleDetailPage />} />
        <Route path="builder" element={<RoleBuilderPage />} />
        <Route path="audit" element={<AuditLogPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route
          path="*"
          element={
            <EmptyState
              icon={Compass}
              title="This page does not exist."
              action={
                <Button asChild>
                  <Link to="/">Go to Home</Link>
                </Button>
              }
            />
          }
        />
      </Route>
    </Routes>
  );
}
