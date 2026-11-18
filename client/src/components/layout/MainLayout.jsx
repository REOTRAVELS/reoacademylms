import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, LogOut, Menu, X } from 'lucide-react';
import { navItems, roleLabel } from '../common/navConfig';
import { useAuth } from '../../hooks/useAuth';
import { notificationsAPI, usersAPI } from '../../services/api';

const pageTitles = {
  '/dashboard': 'Overview',
  '/applications': 'Applications',
  '/students': 'Student directory',
  '/students/new': 'Invite a student',
  '/trainers': 'Trainer directory',
  '/programmes': 'Programmes',
  '/program-assignments': 'Program assignments',
  '/notifications/admin': 'Notification review',
  '/cohorts': 'Cohorts',
  '/courses': 'Courses',
  '/assessments': 'Assessments',
  '/live-classes': 'Live classes',
  '/calendar': 'Academic calendar',
  '/communications': 'Communications',
  '/intakes': 'Intakes',
  '/settings': 'Settings',
};

export default function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationError, setNotificationError] = useState('');
  const [notificationCountError, setNotificationCountError] = useState('');
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [failedAvatarSrc, setFailedAvatarSrc] = useState('');
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const role = typeof user?.role === 'string' ? user.role : user?.role?.name;
  const waitingForIntake = role === 'STUDENT' && user?.intakeAccessState === 'WAITING';
  const items = waitingForIntake
    ? navItems(role).filter(({ href }) => href === '/dashboard' || href === '/settings')
    : navItems(role);
  const avatarSrc = usersAPI.avatarImageUrl(user?.avatarUrl);
  const title = pageTitles[location.pathname] || (
    location.pathname.startsWith('/students/') ? 'Student profile'
      : location.pathname.includes('/builder') ? 'Course builder'
        : location.pathname.startsWith('/courses/') ? 'Course details'
          : location.pathname.startsWith('/intakes/') ? 'Intake details'
            : location.pathname.startsWith('/cohorts/') ? 'Cohort details'
              : 'Academy workspace'
  );
  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase();
  const avatar = () => (
    avatarSrc && failedAvatarSrc !== avatarSrc
      ? <img className="user-avatar" src={avatarSrc} alt="" onError={() => setFailedAvatarSrc(avatarSrc)} />
      : <span className="user-avatar">{initials || 'R'}</span>
  );

  const refreshUnreadCount = useCallback(async () => {
    try {
      const { data } = await notificationsAPI.unreadCount();
      setUnreadCount(data.data.count);
      setNotificationCountError('');
    } catch (requestError) {
      setNotificationCountError(requestError.response?.data?.message || 'Could not load notification count.');
    }
  }, []);

  useEffect(() => {
    if (waitingForIntake) {
      setUnreadCount(0);
      return undefined;
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshUnreadCount();
    };
    refreshUnreadCount();
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    const timer = window.setInterval(refreshWhenVisible, 60_000);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.clearInterval(timer);
    };
  }, [refreshUnreadCount, waitingForIntake]);

  const toggleNotifications = async () => {
    const shouldOpen = !notificationsOpen;
    setNotificationsOpen(shouldOpen);
    setNotificationError('');
    if (!shouldOpen) return;
    setNotificationsLoading(true);
    try {
      const [notificationResponse] = await Promise.all([
        notificationsAPI.listNotifications({ limit: 10 }),
        refreshUnreadCount(),
      ]);
      setNotifications(notificationResponse.data.data || []);
    } catch (requestError) {
      setNotificationError(requestError.response?.data?.message || 'Could not load notifications.');
    } finally {
      setNotificationsLoading(false);
    }
  };

  const markNotificationRead = async (notification) => {
    if (notification.read) return;
    setNotificationError('');
    try {
      await notificationsAPI.markRead(notification.id);
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read: true } : item));
      refreshUnreadCount();
    } catch (requestError) {
      setNotificationError(requestError.response?.data?.message || 'Could not mark notification as read.');
    }
  };

  const markAllNotificationsRead = async () => {
    setNotificationError('');
    try {
      await notificationsAPI.markAllRead();
      setNotifications((current) => current.map((item) => ({ ...item, read: true })));
      await refreshUnreadCount();
    } catch (requestError) {
      setNotificationError(requestError.response?.data?.message || 'Could not mark notifications as read.');
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} aria-label="Main navigation">
        <NavLink to="/dashboard" className="brand-lockup" onClick={() => setSidebarOpen(false)}>
          <img className="brand-logo" src="/reo.png" alt="" />
          <span>
            <strong>REO ACADEMY</strong>
            <small>Travel &amp; learning</small>
          </span>
        </NavLink>

        <div className="sidebar-nav">
          <div className="nav-section-title">Workspace</div>
          {items.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              end={item.href !== '/students'}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <item.icon size={18} strokeWidth={1.8} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>

        <div className="sidebar-footer">
          {avatar()}
          <div className="user-details">
            <strong>{user?.firstName} {user?.lastName}</strong>
            <span>{roleLabel(role)}</span>
          </div>
          <button className="icon-button sidebar-logout" onClick={handleLogout} aria-label="Sign out" title="Sign out">
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-leading">
            <button className="icon-button menu-toggle" onClick={() => setSidebarOpen((open) => !open)} aria-label="Toggle navigation">
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-divider">/</span><strong>{title}</strong></div>
          </div>
          <div className="topbar-actions">
            <span className="topbar-date">{new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</span>
            {!waitingForIntake && <div className="notification-menu">
              <button className="icon-button notification-trigger" aria-label="Notifications" title="Notifications" aria-expanded={notificationsOpen} onClick={toggleNotifications}>
                <Bell size={18} />
                {unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
              </button>
              {notificationsOpen && <section className="notification-popover" aria-label="Notifications">
                <div className="notification-popover-heading">
                  <strong>Notifications</strong>
                  {unreadCount > 0 && <button className="notification-text-button" onClick={markAllNotificationsRead}>Mark all read</button>}
                </div>
                {(notificationError || notificationCountError) && <p className="notification-error" role="alert">{notificationError || notificationCountError}</p>}
                {notificationsLoading ? <p className="notification-empty">Loading notifications…</p> :
                  notifications.length ? <div className="notification-list">{notifications.map((notification) => (
                    <button className={`notification-item${notification.read ? '' : ' unread'}`} key={notification.id} onClick={() => markNotificationRead(notification)}>
                      <span className="notification-item-heading">{notification.title}</span>
                      {notification.body && <span className="notification-item-body">{notification.body}</span>}
                      <time dateTime={notification.createdAt}>{new Date(notification.createdAt).toLocaleString()}</time>
                    </button>
                  ))}</div> :
                    <p className="notification-empty">You’re all caught up.</p>}
              </section>}
            </div>}
            <button className="topbar-profile" onClick={() => navigate('/settings')} aria-label="Open account settings">
              {avatar()}
              <span>{user?.firstName}</span>
            </button>
          </div>
        </header>
        <main className="page-content"><Outlet /></main>
      </div>
    </div>
  );
}
