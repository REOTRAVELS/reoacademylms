import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  BellRing,
  CalendarDays,
  CalendarRange,
  GraduationCap,
  Video,
  MessageSquareText,
  Settings,
  Users,
} from 'lucide-react';

const dashboard = { label: 'Overview', icon: BarChart3, href: '/dashboard' };
const courses = { label: 'Courses', icon: BookOpen, href: '/courses' };
const assessments = { label: 'Assessments', icon: ClipboardCheck, href: '/assessments' };
const liveClasses = { label: 'Live classes', icon: Video, href: '/live-classes' };
const calendar = { label: 'Calendar', icon: CalendarDays, href: '/calendar' };
const communications = { label: 'Communications', icon: MessageSquareText, href: '/communications' };
const settings = { label: 'Settings', icon: Settings, href: '/settings' };

const navigationByRole = {
  SUPER_ADMIN: [
    dashboard,
    { label: 'Students', icon: GraduationCap, href: '/students' },
    { label: 'Applications', icon: ClipboardCheck, href: '/applications' },
    { label: 'Program assignments', icon: GraduationCap, href: '/program-assignments' },
    { label: 'Notification review', icon: BellRing, href: '/notifications/admin' },
    { label: 'Trainers', icon: Users, href: '/trainers' },
    { label: 'Programs', icon: BookOpen, href: '/programmes' },
    { label: 'Intakes', icon: CalendarRange, href: '/intakes' },
    courses,
    assessments,
    liveClasses,
    calendar,
    communications,
    settings,
  ],
  TRAINER: [
    dashboard,
    courses,
    assessments,
    liveClasses,
    calendar,
    communications,
    settings,
  ],
  STUDENT: [
    dashboard,
    { label: 'My learning', icon: GraduationCap, href: '/courses' },
    assessments,
    liveClasses,
    calendar,
    communications,
    settings,
  ],
};

export const navItems = (role) => navigationByRole[role] || [];

export const roleLabel = (role) => ({
  SUPER_ADMIN: 'Academy administrator',
  TRAINER: 'Trainer',
  STUDENT: 'Student',
}[role] || role || 'Member');

export const statusLabel = (status) => ({
  ACTIVE: 'Active',
  PENDING: 'Pending approval',
  SUSPENDED: 'Suspended',
  REJECTED: 'Rejected',
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
  PLANNED: 'Planned',
  COMPLETED: 'Completed',
  UPCOMING: 'Upcoming',
  INACTIVE: 'Inactive',
  CLOSED: 'Closed',
  SUBMITTED: 'Submitted',
  GRADED: 'Graded',
}[status] || status || 'Unknown');

export const statusClass = (status) => `badge badge-${String(status || '').toLowerCase()}`;

export const getDashboardPath = () => '/dashboard';
