import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, CalendarDays, Check, CircleCheck, Copy, Info, Layers } from 'lucide-react';
import QRCode from 'qrcode';
import './styles.css';

// Shared design-system primitives (K-507, PD-65), adapted from the approved v0 design.

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

/** "Sat 24 Oct" in the event's zone. */
export function formatDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

/** "09:00" in the event's zone. */
export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

type Variant = 'primary' | 'outline' | 'ghost' | 'destructive' | 'danger';
type Size = 'md' | 'sm' | 'lg' | 'icon';

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra?: string) {
  return cx('btn', variant !== 'primary' && `btn-${variant}`, size !== 'md' && `btn-${size}`, extra);
}

export function Button({
  variant,
  size,
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function Logo() {
  return (
    <span className="logo">
      <span className="logo-mark" aria-hidden="true">
        <Layers size={19} />
      </span>
      EventFlow<span className="logo-dot">.</span>
    </span>
  );
}

/** A coloured status pill; `tone` picks the colour, the text is always visible (not colour only). */
export function Status({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className={`status status-${tone}`}>
      <span className="status-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  id,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** Receives the generated id to put on the control, so the label is associated. */
  children: (id: string) => ReactNode;
  id?: string;
}) {
  const generated = useId();
  const controlId = id ?? generated;
  return (
    <div className="field">
      <label htmlFor={controlId}>{label}</label>
      {children(controlId)}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function Empty({ title, text, icon }: { title: string; text?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon ?? <CalendarDays size={28} aria-hidden="true" />}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
    </div>
  );
}

export function Skeleton({ height, width }: { height: number; width?: string | number }) {
  return <div className="skeleton" style={{ height, width: width ?? '100%' }} aria-hidden="true" />;
}

export function PageSkeleton() {
  return (
    <div className="page-skeleton" aria-busy="true" aria-label="Loading">
      <Skeleton height={14} width={180} />
      <Skeleton height={34} width={420} />
      <Skeleton height={110} />
      <Skeleton height={280} />
    </div>
  );
}

/**
 * A confirmation step in a native <dialog> (focus trap, Escape and backdrop handled by the
 * browser). The action runs only on the explicit confirm button; the caller keeps any server call.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Keep it as is',
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onClose(); // a click on the backdrop
      }}
    >
      {open && (
        <>
          <div className="dialog-body">
            <h2 id={titleId}>{title}</h2>
            {children}
          </div>
          <div className="dialog-footer">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              {cancelLabel}
            </Button>
            <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
              {confirmLabel}
            </Button>
          </div>
        </>
      )}
    </dialog>
  );
}

const ALERT_ICON = { error: AlertCircle, info: Info, success: CircleCheck, warning: AlertCircle } as const;

export function Alert({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'info' | 'success' | 'warning';
  children: ReactNode;
}) {
  const Icon = ALERT_ICON[kind];
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function CopyLink({ label, url, compact = false }: { label: string; url: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard
      ?.writeText(url)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };
  const row = (
    <div className="link-field">
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={label} />
      <Button
        variant="ghost"
        size="sm"
        onClick={copy}
        aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
  if (compact) return row;
  return (
    <div className="copy-link">
      <span className="field-label">{label}</span>
      {row}
    </div>
  );
}

export function TicketQr({ code, size = 220 }: { code: string; size?: number }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    void QRCode.toDataURL(code, { margin: 1, width: size }).then(setSrc);
  }, [code, size]);
  return (
    <figure className="ticket">
      {src && <img src={src} alt={`QR code for ticket ${code}`} width={size} height={size} />}
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
