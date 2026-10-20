import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { Spinner } from './components/ui';
import { useAuth } from './hooks/useAuth';
import { AnalyticsPage } from './pages/Analytics';
import { AssistantPage } from './pages/Assistant';
import { LoginPage, SignupPage } from './pages/Auth';
import { AutomationEditorPage } from './pages/AutomationEditor';
import { AutomationsPage } from './pages/Automations';
import { CustomersPage } from './pages/Customers';
import { DashboardPage } from './pages/Dashboard';
import { DocsPage } from './pages/Docs';
import { InboxPage } from './pages/Inbox';
import { KnowledgePage } from './pages/Knowledge';
import { LandingPage } from './pages/Landing';
import { MenusPage } from './pages/Menus';
import { NotFoundPage } from './pages/NotFound';
import { SettingsPage } from './pages/Settings';
import { SimulatorPage } from './pages/Simulator';

function Protected({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/docs" element={<DocsPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route
        path="/app"
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="inbox/:id" element={<InboxPage />} />
        <Route path="automations" element={<AutomationsPage />} />
        <Route path="automations/:id" element={<AutomationEditorPage />} />
        <Route path="menus" element={<MenusPage />} />
        <Route path="menus/:id" element={<MenusPage />} />
        <Route path="assistant" element={<AssistantPage />} />
        <Route path="knowledge" element={<KnowledgePage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="simulator" element={<SimulatorPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
