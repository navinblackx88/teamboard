import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppLayout } from "@/components/Layout";
import { ConfirmHost, PageSpinner } from "@/components/common";
import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/stores/auth";
import { AcceptInvite, AuthCallback, Login, Onboarding, Signup } from "@/pages/Auth";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Projects = lazy(() => import("./pages/Projects"));
const BoardPage = lazy(() => import("./pages/Board"));
const Sprints = lazy(() => import("./pages/Sprints"));
const ProjectSettings = lazy(() => import("./pages/ProjectSettings"));
const MyTasks = lazy(() => import("./pages/MyTasks"));
const ActivityPage = lazy(() => import("./pages/Activity"));
const Members = lazy(() => import("./pages/Members"));
const Settings = lazy(() => import("./pages/Settings"));
const Profile = lazy(() => import("./pages/Profile"));

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.accessToken);
  const location = useLocation();
  if (!token) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <>
      <Suspense fallback={<PageSpinner />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/invite/:token" element={<AcceptInvite />} />
          <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
          <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/my-tasks" element={<MyTasks />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:pid/board" element={<BoardPage />} />
            <Route path="/projects/:pid/sprints" element={<Sprints />} />
            <Route path="/projects/:pid/settings" element={<ProjectSettings />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/members" element={<Members />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
      <Toaster position="bottom-right" richColors closeButton />
      <ConfirmHost />
    </>
  );
}
