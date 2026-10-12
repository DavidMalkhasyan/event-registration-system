import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ShieldOff } from 'lucide-react';
import { CheckInPanel } from '../checkin/CheckInPanel';
import { api } from '../shared/api';
import { Logo, PageSkeleton, Status } from '../shared/ui';

// Staff device entry (FR-STAFF-2, PD-69): its own bundle, no organizer code. It calls only
// /api/staff/session and, through CheckInPanel, the check-in, count and live endpoints of its event.

interface StaffView {
  eventId: string;
  event: { title: string; startsAt: string; timeZone: string };
  windowOpensAt: string;
  windowClosesAt: string;
  csrfToken: string;
}

function StaffShell({ children }: { children: ReactNode }) {
  return (
    <div className="staff-shell">
      <header>
        <Logo />
        <span className="staff-label">STAFF CHECK-IN</span>
      </header>
      <main>{children}</main>
    </div>
  );
}

function StaffApp() {
  const [view, setView] = useState<StaffView | null | undefined>();
  useEffect(() => {
    api<StaffView>('/api/staff/session')
      .then(setView)
      .catch(() => setView(null));
  }, []);
  if (view === undefined)
    return (
      <StaffShell>
        <PageSkeleton />
      </StaffShell>
    );
  if (view === null)
    return (
      <StaffShell>
        <section className="center-card">
          <span className="result-icon">
            <ShieldOff aria-hidden="true" />
          </span>
          <h1>No check-in access</h1>
          <p>
            This device has no check-in access, or it has ended (the check-in window closed, the event was
            cancelled, or the organizer revoked it). Ask the organizer for a new invitation.
          </p>
        </section>
      </StaffShell>
    );
  return (
    <StaffShell>
      <CheckInPanel
        csrfToken={view.csrfToken}
        eventId={view.eventId}
        mode="staff"
        event={{
          title: view.event.title,
          timeZone: view.event.timeZone,
          opensAt: view.windowOpensAt,
          closesAt: view.windowClosesAt,
          status: <Status tone="active">Staff access</Status>,
        }}
      />
    </StaffShell>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StaffApp />
  </StrictMode>,
);
