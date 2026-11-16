import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth.jsx';
import MainLayout from './components/layout/MainLayout';
import LoginPage from './features/authentication/LoginPage';
import RegisterPage from './features/authentication/RegisterPage';
import PendingPage from './features/authentication/PendingPage';
import AcceptInvitePage from './features/authentication/AcceptInvitePage';
import AdminDashboard from './features/dashboard/AdminDashboard';
import TrainerDashboard from './features/dashboard/TrainerDashboard';
import StudentDashboard from './features/dashboard/StudentDashboard';
import StudentsPage from './features/students/StudentsPage';
import StudentProfilePage from './features/students/StudentProfilePage';
import TrainersPage from './features/trainers/TrainersPage';
import ProgrammesPage from './features/programmes/ProgrammesPage';
import CohortsPage from './features/cohorts/CohortsPage';
import CoursesPage from './features/courses/CoursesPage';
import AssessmentsPage from './features/assessments/AssessmentsPage';
import StudentInvitationPage from './features/students/StudentInvitationPage';
import SettingsPage from './features/settings/SettingsPage';

function RoleGuard({ children, allowedRoles }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
        Loading...
      </div>
    );
  }
  if (!user) return null;
  if (allowedRoles && !allowedRoles.includes(user.role.name)) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

function DashboardRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  switch (user.role.name) {
    case 'SUPER_ADMIN': return <AdminDashboard />;
    case 'TRAINER': return <TrainerDashboard />;
    case 'STUDENT': return <StudentDashboard />;
    default: return <AdminDashboard />;
  }
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/pending" element={<PendingPage />} />
        <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />

        <Route element={<MainLayout />}>
          <Route element={<RoleGuard allowedRoles={['SUPER_ADMIN', 'TRAINER', 'STUDENT']} />}>
            <Route path="/dashboard" element={<DashboardRedirect />} />
            <Route path="/students" element={<StudentsPage />} />
            <Route path="/students/new" element={<StudentInvitationPage />} />
            <Route path="/students/:id" element={<StudentProfilePage />} />
            <Route path="/trainers" element={<TrainersPage />} />
            <Route path="/programmes" element={<ProgrammesPage />} />
            <Route path="/cohorts" element={<CohortsPage />} />
            <Route path="/courses" element={<CoursesPage />} />
            <Route path="/assessments" element={<AssessmentsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;

