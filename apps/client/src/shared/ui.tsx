import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import './styles.css';

/** Event local time with the zone named (FR-EVT-2, FR-NTF-6). */
export function formatLocal(iso: string, timeZone: string): string {
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
  return `${text} (${timeZone})`;
}

export function Page({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <main className="page">
      <header className="page-header">
        <h1>{title}</h1>
        {actions}
      </header>
      {children}
    </main>
  );
}

export function Card({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <section className="card">
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

export function Alert({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'info' | 'success';
  children: ReactNode;
}) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function CopyLink({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-link">
      <label>{label}</label>
      <div className="copy-row">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={label} />
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function TicketQr({ code }: { code: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    void QRCode.toDataURL(code, { margin: 1, width: 220 }).then(setSrc);
  }, [code]);
  return (
    <figure className="ticket">
      {src && <img src={src} alt={`QR code for ticket ${code}`} width={220} height={220} />}
      <figcaption className="ticket-code">{code}</figcaption>
    </figure>
  );
}

export const TRANSFER_STATEMENT = 'This ticket can be transferred, but it admits one person, once.';

export function DevMailboxHint() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    void fetch('/dev/mailbox', { method: 'HEAD' })
      .then((r) => setAvailable(r.ok))
      .catch(() => setAvailable(false));
  }, []);
  if (!available) return null;
  return (
    <p className="muted">
      Demo setup: emails are delivered to the{' '}
      <a href="/dev/mailbox" target="_blank" rel="noreferrer">
        development mailbox
      </a>
      , not to real inboxes.
    </p>
  );
}

export function InvalidLink() {
  return (
    <Page title="Link not valid">
      <Card>
        <p>This link is not valid or has expired.</p>
        <p className="muted">If you were trying to register, please start again from the event page.</p>
      </Card>
    </Page>
  );
}
