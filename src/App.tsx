import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import HomePage from "./pages/Home";
import RulesPage from "./pages/rules/RulesPage";
import ConnectionsPage from "./pages/connections/ConnectionsPage";
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

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="rules" element={<RulesPage />} />
        <Route path="connections" element={<ConnectionsPage />} />
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
