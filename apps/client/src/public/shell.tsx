import type { ReactNode } from 'react';
import { Link2Off } from 'lucide-react';
import { Logo, PageSkeleton, Status, TRANSFER_STATEMENT, TicketQr, formatLocal } from '../shared/ui';

// Participant and link pages (K-507): v0's public shell. Self-contained: no remote resources, no
// links that carry tokens, and the same generic page for every invalid link (FR-LNK-7).

export interface EventSummary {
  title: string;
  startsAt: string;
  timeZone: string;
}

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="public-shell">
      <header className="public-header">
        <Logo />
        <span className="public-tagline">GOOD PEOPLE. GREAT GATHERINGS.</span>
      </header>
      {children}
      <footer className="public-footer">
        <Logo />
        <p>Thoughtfully connected. Seamlessly organized.</p>
      </footer>
    </div>
  );
}

/** A focused single-card page (link confirmations, results, errors). */
export function CenterPage({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <PublicShell>
      <main className={wide ? 'public-center public-center-wide' : 'public-center'}>{children}</main>
    </PublicShell>
  );
}

export function LoadingPage() {
  return (
    <CenterPage>
      <div className="center-card">
        <PageSkeleton />
      </div>
    </CenterPage>
  );
}

/** The one page for any invalid, expired, used or revoked link (FR-LNK-7): it never says which. */
export function InvalidLinkPage() {
  return (
    <CenterPage>
      <section className="center-card">
        <span className="result-icon">
          <Link2Off aria-hidden="true" />
        </span>
        <h1>Link not valid</h1>
        <p>This link is not valid or has expired.</p>
        <p className="muted">If you were trying to register, please start again from the event page.</p>
      </section>
    </CenterPage>
  );
}

/**
 * The ticket (v0 ticket card). `code` is shown only when the server returned it for this view; the
 * QR code is generated on this device and encodes the ticket code only.
 */
export function TicketCard({
  event,
  status,
  code,
  note,
  children,
}: {
  event: EventSummary;
  status: { tone: string; label: string };
  code?: string;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="ticket-card" aria-label="Ticket">
      <div className="ticket-top">
        <Logo />
        <Status tone={status.tone}>{status.label}</Status>
      </div>
      <div className="ticket-info">
        <span className="eyebrow">Your next great gathering</span>
        <h2>{event.title}</h2>
        <p>{formatLocal(event.startsAt, event.timeZone)}</p>
      </div>
      <div className="ticket-perforation" aria-hidden="true" />
      {code ? (
        <div className="ticket-qr">
          <TicketQr code={code} size={208} />
          <p>Show this code at the door. We’ll take care of the rest.</p>
        </div>
      ) : (
        note && <div className="ticket-note">{note}</div>
      )}
      {children}
      {code && (
        <div className="ticket-bottom">
          <strong>{TRANSFER_STATEMENT}</strong>
        </div>
      )}
    </section>
  );
}
