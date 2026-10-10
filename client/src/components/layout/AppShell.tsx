import { NavLink, Outlet } from 'react-router';
import styles from '../../styles/app-shell.module.css';
import { ServerStatus } from './ServerStatus';
import { ThemeToggle } from './ThemeToggle';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-surface-2 font-semibold text-fg' : 'text-muted hover:text-fg'}`;

// [CONCEPT: Semantic HTML Landmarks] header / nav / main / footer let assistive tech jump between regions.
export function AppShell() {
  return (
    <div className={styles.shell}>
      <a href="#main-content" className={styles.skipLink}>
        Skip to main content
      </a>
      <header className={styles.header}>
        <NavLink to="/" className="flex items-center gap-2 font-bold">
          <img src="/favicon.svg" alt="" width={24} height={24} />
          {/* Hidden visually on narrow phones so the nav fits; still read by screen readers. */}
          <span className="max-sm:sr-only">DevVerse</span>
        </NavLink>
        <nav aria-label="Primary">
          <ul className="flex items-center gap-1">
            <li>
              <NavLink to="/dashboard" className={navLinkClass}>
                Dashboard
              </NavLink>
            </li>
            <li>
              <NavLink to="/challenges" className={navLinkClass}>
                Challenges
              </NavLink>
            </li>
          </ul>
        </nav>
        <ThemeToggle />
      </header>
      <main id="main-content" className={styles.main} tabIndex={-1}>
        <Outlet />
      </main>
      <footer className={styles.footer}>
        <ServerStatus />
      </footer>
    </div>
  );
}
