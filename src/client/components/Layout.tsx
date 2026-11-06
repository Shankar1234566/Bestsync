/**
 * Application shell: sticky topbar (brand, nav, theme + account actions)
 * with routed content underneath. Floating music notes decorate the page.
 */
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useTheme } from '../state/ThemeContext';
import { MusicNotes } from './MusicNotes';

const NAV_ITEMS = [
  { to: '/', label: 'Play', end: true },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/friends', label: 'Friends' },
  { to: '/profile', label: 'Profile' },
];

export function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <MusicNotes />
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand-mark">♪</span>
          <span>
            Beat<span className="brand-grad">Sync</span>
          </span>
        </NavLink>

        <nav className="nav" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="topbar-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          {user ? (
            <>
              <button type="button" className="btn btn-soft btn-sm" onClick={() => navigate('/profile')}>
                {user.username} · Lv {user.level}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
                Sign out
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/auth')}>
              Sign in
            </button>
          )}
        </div>
      </header>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
