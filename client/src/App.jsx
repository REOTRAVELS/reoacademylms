import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth.jsx';
import MainLayout from './components/layout/MainLayout';
import LoginPage from './features/authentication/LoginPage';
import RegisterPage from './features/authentication/RegisterPage';
import PendingPage from './features/authentication/PendingPage';
import AcceptInvitePage from './features/authentication/AcceptInvitePage';
import ForgotPasswordPage from './features/authentication/ForgotPasswordPage';
import ResetPasswordPage from './features/authentication/ResetPasswordPage';
import AdminDashboard from './features/dashboard/AdminDashboard';
import TrainerDashboard from './features/dashboard/TrainerDashboard';
import StudentDashboard from './features/dashboard/StudentDashboard';
import StudentsPage from './features/students/StudentsPage';
import StudentProfilePage from './features/students/StudentProfilePage';
import ApplicationsPage from './features/students/ApplicationsPage';
import ProgramAssignmentsPage from './features/students/ProgramAssignmentsPage';
import NotificationReviewPage from './features/notifications/NotificationReviewPage';
import TrainersPage from './features/trainers/TrainersPage';
import ProgrammesPage from './features/programmes/ProgrammesPage';
import IntakesPage from './features/intakes/IntakesPage';
import IntakeDetailPage from './features/intakes/IntakeDetailPage';
import CohortsPage from './features/cohorts/CohortsPage';
import CohortDetailPage from './features/cohorts/CohortDetailPage';
import CoursesPage from './features/courses/CoursesPage';
import CourseDetailPage from './features/courses/CourseDetailPage';
import CourseBuilderPage from './features/courses/CourseBuilderPage';
import AssessmentsPage from './features/assessments/AssessmentsPage';
import CommunicationsPage from './features/communications/CommunicationsPage';
import StudentInvitationPage from './features/students/StudentInvitationPage';
import SettingsPage from './features/settings/SettingsPage';
const LiveClassesPage = lazy(() => import('./features/liveClasses/LiveClassesPage'));
const CalendarPage = lazy(() => import('./features/liveClasses/CalendarPage'));
const ClassroomPage = lazy(() => import('./features/liveClasses/room/ClassroomPage'));

function RoleGuard({ allowedRoles }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
        Loading...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  const role = typeof user.role === 'string' ? user.role : user.role?.name;
  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}

function DashboardRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const role = typeof user.role === 'string' ? user.role : user.role?.name;
  switch (role) {
    case 'SUPER_ADMIN': return <AdminDashboard />;
    case 'TRAINER': return <TrainerDashboard />;
    case 'STUDENT': return <StudentDashboard />;
    default: return <AdminDashboard />;
  }
}

function StudentAcademicGuard() {
  const { user } = useAuth();
  const role = typeof user?.role === 'string' ? user.role : user?.role?.name;
  if (role === 'STUDENT' && user.academicAccess === false) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/pending" element={<PendingPage />} />
        <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        <Route element={<RoleGuard allowedRoles={['SUPER_ADMIN', 'TRAINER', 'STUDENT']} />}>
          {/* The live classroom is a full-screen app of its own, outside the LMS shell. */}
          <Route element={<StudentAcademicGuard />}>
            <Route
              path="/live-classes/:id/room"
              element={<Suspense fallback={<div className="rt-screen rt-screen--center" role="status">Opening the classroom…</div>}><ClassroomPage /></Suspense>}
            />
          </Route>
          <Route element={<MainLayout />}>
            <Route path="/dashboard" element={<DashboardRedirect />} />
            <Route element={<RoleGuard allowedRoles={['SUPER_ADMIN']} />}>
              <Route path="/students" element={<StudentsPage />} />
              <Route path="/applications" element={<ApplicationsPage />} />
              <Route path="/program-assignments" element={<ProgramAssignmentsPage />} />
              <Route path="/notifications/admin" element={<NotificationReviewPage />} />
              <Route path="/students/new" element={<StudentInvitationPage />} />
              <Route path="/students/:id" element={<StudentProfilePage />} />
              <Route path="/trainers" element={<TrainersPage />} />
              <Route path="/programmes" element={<ProgrammesPage />} />
              <Route path="/intakes" element={<IntakesPage />} />
              <Route path="/intakes/:id" element={<IntakeDetailPage />} />
              <Route path="/cohorts" element={<CohortsPage />} />
              <Route path="/cohorts/:id" element={<CohortDetailPage />} />
            </Route>
            <Route element={<StudentAcademicGuard />}>
              <Route element={<RoleGuard allowedRoles={['SUPER_ADMIN', 'TRAINER', 'STUDENT']} />}>
                <Route path="/courses" element={<CoursesPage />} />
                <Route path="/courses/:id" element={<CourseDetailPage />} />
              </Route>
              <Route element={<RoleGuard allowedRoles={['SUPER_ADMIN', 'TRAINER', 'STUDENT']} />}>
                <Route path="/assessments" element={<AssessmentsPage />} />
                <Route path="/live-classes" element={<Suspense fallback={<p>Loading classroom…</p>}><LiveClassesPage /></Suspense>} />
                <Route path="/calendar" element={<Suspense fallback={<p>Loading timetable…</p>}><CalendarPage /></Suspense>} />
                <Route path="/communications" element={<CommunicationsPage />} />
              </Route>
            </Route>
            <Route element={<RoleGuard allowedRoles={['SUPER_ADMIN', 'TRAINER']} />}>
              <Route path="/courses/:id/builder" element={<CourseBuilderPage />} />
            </Route>
            <Route element={<RoleGuard allowedRoles={['SUPER_ADMIN', 'TRAINER', 'STUDENT']} />}>
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
