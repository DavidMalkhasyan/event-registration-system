import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { LogOut, ShieldOff } from 'lucide-react';
import { CheckInPanel } from '../checkin/CheckInPanel';
import { api, errorMessage } from '../shared/api';
import { Alert, Button, ConfirmDialog, Logo, PageSkeleton, Status } from '../shared/ui';

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

/**
 * K-715 (PD-95): ends this device's own access, for a shared or borrowed phone at the end of a shift.
 * The organizer can still invite the person again.
 */
function EndAccess({ csrfToken, onEnded }: { csrfToken: string; onEnded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const end = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api('/api/staff/sign-out', { method: 'POST', csrf: csrfToken });
      onEnded();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <div className="staff-end">
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <LogOut size={15} aria-hidden="true" /> End access on this device
      </Button>
      <ConfirmDialog
        open={open}
        title="End check-in access on this device?"
        confirmLabel="End access"
        cancelLabel="Keep checking in"
        destructive
        busy={busy}
        onConfirm={() => void end()}
        onClose={() => setOpen(false)}
      >
        <p>
          This device can no longer check tickets in. Use it when you hand the phone back or your shift ends;
          the organizer can invite you again.
        </p>
        {error && <Alert>{error}</Alert>}
      </ConfirmDialog>
    </div>
  );
}

function StaffApp() {
  const [view, setView] = useState<StaffView | null | undefined>();
  const [ended, setEnded] = useState(false);
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
  if (ended)
    return (
      <StaffShell>
        <section className="center-card">
          <span className="result-icon">
            <ShieldOff aria-hidden="true" />
          </span>
          <h1>Access ended on this device</h1>
          <p>This device can no longer check tickets in. Thank you for helping at the door.</p>
        </section>
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
      <EndAccess csrfToken={view.csrfToken} onEnded={() => setEnded(true)} />
    </StaffShell>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StaffApp />
  </StrictMode>,
);
