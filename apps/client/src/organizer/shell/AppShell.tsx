import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, ChevronRight, LayoutDashboard, LogOut, Menu, Sparkles, X } from 'lucide-react';
import { api } from '../../shared/api';
import { Button, Logo } from '../../shared/ui';
import { SWATCHES, artworkIndex } from '../events/EventArtwork';
import { isUpcoming } from '../events/event-status';
import { Link } from '../router';
import type { EventListItem, Session } from '../types';
import { useMobileNavigation } from './use-mobile-navigation';

export type NavKey = 'overview' | 'events' | 'create' | 'event';

const NAV = [
  { key: 'overview', name: 'Overview', to: '/organizer', icon: LayoutDashboard },
  { key: 'events', name: 'All events', to: '/organizer/events', icon: CalendarDays },
  { key: 'create', name: 'Create event', to: '/organizer/events/new', icon: Sparkles },
] as const;

async function signOut(session: Session) {
  await api('/api/auth/sign-out', { method: 'POST', csrf: session.csrfToken }).catch(() => undefined);
  window.location.assign('/organizer');
}

/** The organizer workspace frame: sidebar, top bar and main area (v0 layout). */
export function AppShell({
  session,
  events,
  active,
  activeEventId,
  crumbs,
  children,
}: {
  session: Session;
  events: EventListItem[] | undefined;
  active: NavKey;
  activeEventId?: string;
  crumbs: { label: string; to?: string }[];
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const { ref: navRef, narrow } = useMobileNavigation(mobileOpen, setMobileOpen);
  const accountRef = useRef<HTMLDivElement>(null);
  const upcoming = (events ?? []).filter(isUpcoming).sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  useEffect(() => {
    if (!accountOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!accountRef.current?.contains(e.target as Node)) setAccountOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAccountOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [accountOpen]);

  const closeMobile = () => setMobileOpen(false);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside
        id="workspace-navigation"
        ref={navRef}
        className={`sidebar${mobileOpen ? ' mobile-open' : ''}`}
        aria-label="Workspace navigation"
        role={narrow && mobileOpen ? 'dialog' : undefined}
        aria-modal={narrow && mobileOpen ? true : undefined}
      >
        <div className="sidebar-brand">
          <Link to="/organizer" aria-label="EventFlow overview" onClick={closeMobile} className="brand-link">
            <Logo />
          </Link>
          <button className="mobile-close" aria-label="Close navigation" onClick={closeMobile}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {NAV.map((n) => (
            <Link
              key={n.key}
              to={n.to}
              className="nav-item"
              aria-current={active === n.key ? 'page' : undefined}
              onClick={closeMobile}
            >
              <n.icon size={19} aria-hidden="true" />
              <span>{n.name}</span>
              {n.key === 'events' && events && <span className="nav-count">{events.length}</span>}
            </Link>
          ))}
        </nav>
        {upcoming.length > 0 && (
          <div className="sidebar-section">
            <div className="nav-caption">UPCOMING EVENTS</div>
            <nav className="sidebar-events" aria-label="Upcoming events">
              {upcoming.slice(0, 6).map((e) => (
                <Link
                  key={e.id}
                  to={`/organizer/events/${e.id}`}
                  aria-current={activeEventId === e.id ? 'page' : undefined}
                  onClick={closeMobile}
                >
                  <span
                    className="event-swatch"
                    style={{ background: SWATCHES[artworkIndex(e.id)] }}
                    aria-hidden="true"
                  />
                  <span>{e.title}</span>
                </Link>
              ))}
            </nav>
          </div>
        )}
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <strong>
              <Sparkles size={15} aria-hidden="true" /> More moments. Less busywork.
            </strong>
            <p>Bring people together. We’ll handle the registrations, the waiting list and the door.</p>
          </div>
          <div className="sidebar-profile">
            <span className="avatar" aria-hidden="true">
              {session.email.slice(0, 2)}
            </span>
            <div>
              <strong>{session.email}</strong>
              <small>Organizer</small>
            </div>
          </div>
        </div>
      </aside>
      {mobileOpen && <button className="mobile-backdrop" aria-label="Close menu" onClick={closeMobile} />}
      <div className="workspace-main" inert={narrow && mobileOpen ? true : undefined}>
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="mobile-menu"
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              aria-controls="workspace-navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={21} aria-hidden="true" />
            </button>
            <nav aria-label="Breadcrumb" className="breadcrumbs">
              {crumbs.map((c, i) => (
                <span key={`${c.label}-${i}`} className="crumb">
                  {i > 0 && <ChevronRight size={13} aria-hidden="true" />}
                  {c.to ? <Link to={c.to}>{c.label}</Link> : <strong aria-current="page">{c.label}</strong>}
                </span>
              ))}
            </nav>
          </div>
          <div className="topbar-right" ref={accountRef}>
            <button
              className="account-button"
              aria-haspopup="true"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen(!accountOpen)}
            >
              <span className="avatar" aria-hidden="true">
                {session.email.slice(0, 2)}
              </span>
              <span className="account-email">{session.email}</span>
              <span className="sr-only">Account menu</span>
            </button>
            {accountOpen && (
              <div className="account-menu">
                <strong>Signed in</strong>
                <p>{session.email}</p>
                <Button variant="outline" onClick={() => void signOut(session)}>
                  <LogOut aria-hidden="true" />
                  Sign out
                </Button>
              </div>
            )}
          </div>
        </header>
        <main id="main" className="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
