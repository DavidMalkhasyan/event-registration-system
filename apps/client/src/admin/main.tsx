import { StrictMode, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Building2, History, LogOut, ShieldCheck } from 'lucide-react';
import { ApiError, api, errorMessage } from '../shared/api';
import { Alert, Button, ConfirmDialog, Empty, Field, Logo, PageSkeleton, Status } from '../shared/ui';

// The Super Admin area (K-710, PD-90): its own entry and bundle at /admin, its own session cookie
// (SameSite=Strict) and CSRF token. Super Admins decide on organizations; there is no way here to
// create a Super Admin (that is the operator command `pnpm admin:create`).

interface AdminSession {
  email: string;
  displayName: string;
  csrfToken: string;
}

type OrgStatus = 'pending_verification' | 'pending_approval' | 'active' | 'rejected' | 'suspended';
type Decision = 'approve' | 'reject' | 'suspend' | 'reinstate';

interface Organization {
  id: string;
  name: string;
  description: string | null;
  status: OrgStatus;
  createdAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  memberCount: number;
  eventCount: number;
  owners: { email: string; name: string | null; emailVerified: boolean }[];
}

interface AuditRecord {
  id: string;
  occurredAt: string;
  action: string;
  actorKind: string;
  adminName: string | null;
  outcome: string;
  reason: string | null;
}

const FILTERS: { status: OrgStatus | 'all'; label: string }[] = [
  { status: 'pending_approval', label: 'Awaiting approval' },
  { status: 'active', label: 'Active' },
  { status: 'suspended', label: 'Suspended' },
  { status: 'rejected', label: 'Rejected' },
  { status: 'pending_verification', label: 'Email not confirmed' },
  { status: 'all', label: 'All' },
];

const STATUS_VIEW: Record<OrgStatus, { label: string; tone: string }> = {
  pending_verification: { label: 'Email not confirmed', tone: 'neutral' },
  pending_approval: { label: 'Awaiting approval', tone: 'pending' },
  active: { label: 'Active', tone: 'valid' },
  rejected: { label: 'Rejected', tone: 'revoked' },
  suspended: { label: 'Suspended', tone: 'revoked' },
};

// Which decisions each state allows (the server enforces the same table).
const ACTIONS: Record<OrgStatus, Decision[]> = {
  pending_verification: [],
  pending_approval: ['approve', 'reject'],
  active: ['suspend'],
  rejected: [],
  suspended: ['reinstate'],
};

const DECISION_VIEW: Record<
  Decision,
  { label: string; title: string; text: string; reason: boolean; destructive: boolean }
> = {
  approve: {
    label: 'Approve',
    title: 'Approve this organization?',
    text: 'Its organizers can then create and manage events. The owners are emailed.',
    reason: false,
    destructive: false,
  },
  reject: {
    label: 'Reject',
    title: 'Reject this registration?',
    text: 'The organization cannot create or manage events. The owners are emailed the reason.',
    reason: true,
    destructive: true,
  },
  suspend: {
    label: 'Suspend',
    title: 'Suspend this organization?',
    text: 'Its organizers lose access to event management until it is reinstated. Public event pages, registrations and staff check-in continue. The owners are emailed the reason.',
    reason: true,
    destructive: true,
  },
  reinstate: {
    label: 'Reinstate',
    title: 'Reinstate this organization?',
    text: 'Its organizers can manage events again. The owners are emailed.',
    reason: false,
    destructive: false,
  },
};

const PAST: Record<Decision, string> = {
  approve: 'approved',
  reject: 'rejected',
  suspend: 'suspended',
  reinstate: 'reinstated',
};

const ACTION_LABEL: Record<string, string> = {
  organization_registered: 'Registered',
  organization_approve: 'Approved',
  organization_reject: 'Rejected',
  organization_suspend: 'Suspended',
  organization_reinstate: 'Reinstated',
};

const when = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

function Shell({
  session,
  onSignOut,
  children,
}: {
  session?: AdminSession;
  onSignOut?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="admin-shell">
      <header className="admin-header">
        <Logo />
        <span className="staff-label">PLATFORM ADMINISTRATION</span>
        {session && (
          <div className="admin-user">
            <span>{session.displayName}</span>
            <Button variant="outline" size="sm" onClick={onSignOut}>
              <LogOut size={15} aria-hidden="true" /> Sign out
            </Button>
          </div>
        )}
      </header>
      <main className="admin-main">{children}</main>
    </div>
  );
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api('/api/admin/sessions', {
        method: 'POST',
        body: { email, password, ...(code.trim() ? { code: code.trim() } : {}) },
      });
      window.location.assign('/admin'); // a full load brings the session's anti-forgery token
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'invalid_credentials'
          ? 'The email address, password or authentication code is not correct.'
          : err instanceof ApiError && err.code === 'second_factor_required'
            ? 'This account has no second factor yet. Ask the operator to enrol one (pnpm admin:totp), then sign in with its code.'
            : errorMessage(err),
      );
      setBusy(false);
    }
  };
  return (
    <Shell>
      <section className="center-card auth-card">
        <span className="result-icon">
          <ShieldCheck aria-hidden="true" />
        </span>
        <h1>Super Admin sign-in</h1>
        <p>For platform administrators only. Organizers sign in at /organizer.</p>
        <form className="stack" onSubmit={submit}>
          <Field label="Email address">
            {(id) => (
              <input
                id={id}
                className="input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            )}
          </Field>
          <Field label="Password">
            {(id) => (
              <input
                id={id}
                className="input"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            )}
          </Field>
          {/* K-718 (PD-99): the code from the Super Admin's authenticator app (required once enrolled). */}
          <Field label="Authentication code" hint="The 6-digit code from your authenticator app.">
            {(id) => (
              <input
                id={id}
                className="input"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                autoComplete="one-time-code"
              />
            )}
          </Field>
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        {error && <Alert>{error}</Alert>}
      </section>
    </Shell>
  );
}

function OrganizationHistory({ id }: { id: string }) {
  const [records, setRecords] = useState<AuditRecord[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api<{ records: AuditRecord[] }>(`/api/admin/organizations/${id}/audit`)
      .then((r) => setRecords(r.records))
      .catch((e) => setError(errorMessage(e)));
  }, [id]);
  if (error) return <Alert>{error}</Alert>;
  if (!records) return <p className="muted">Loading the history…</p>;
  return (
    <ol className="admin-history" aria-label="History">
      {records.map((r) => (
        <li key={r.id}>
          <strong>{ACTION_LABEL[r.action] ?? r.action}</strong>
          <span>
            {when(r.occurredAt)}
            {r.adminName ? ` · by ${r.adminName}` : r.actorKind === 'account' ? ' · by the owner' : ''}
          </span>
          {r.reason && <span className="admin-reason">Reason: {r.reason}</span>}
        </li>
      ))}
    </ol>
  );
}

function OrganizationCard({
  org,
  onDecide,
}: {
  org: Organization;
  onDecide: (org: Organization, decision: Decision) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const view = STATUS_VIEW[org.status];
  return (
    <article className="panel admin-org" aria-label={org.name}>
      <div className="admin-org-head">
        <div>
          <h2>{org.name}</h2>
          <Status tone={view.tone}>{view.label}</Status>
        </div>
        <div className="admin-org-actions">
          {ACTIONS[org.status].map((d) => (
            <Button
              key={d}
              size="sm"
              variant={DECISION_VIEW[d].destructive ? 'outline' : 'primary'}
              onClick={() => onDecide(org, d)}
            >
              {DECISION_VIEW[d].label}
            </Button>
          ))}
        </div>
      </div>
      <dl className="admin-facts">
        <div>
          <dt>Owner</dt>
          <dd>
            {org.owners.map((o) => (
              <span key={o.email}>
                {o.name ? `${o.name} · ` : ''}
                {o.email}
                {!o.emailVerified && ' (not confirmed)'}
              </span>
            ))}
          </dd>
        </div>
        <div>
          <dt>Registered</dt>
          <dd>{when(org.submittedAt ?? org.createdAt)}</dd>
        </div>
        <div>
          <dt>Organizers · events</dt>
          <dd>
            {org.memberCount} · {org.eventCount}
          </dd>
        </div>
        {org.decidedAt && (
          <div>
            <dt>Last decision</dt>
            <dd>{when(org.decidedAt)}</dd>
          </div>
        )}
      </dl>
      {org.description && <p className="admin-description">{org.description}</p>}
      {org.decisionReason && <p className="admin-reason">Reason given: {org.decisionReason}</p>}
      <button
        type="button"
        className="link-button"
        onClick={() => setShowHistory((v) => !v)}
        aria-expanded={showHistory}
      >
        <History size={14} aria-hidden="true" /> {showHistory ? 'Hide history' : 'Show history'}
      </button>
      {showHistory && <OrganizationHistory id={org.id} />}
    </article>
  );
}

function Organizations({ session }: { session: AdminSession }) {
  const [filter, setFilter] = useState<OrgStatus | 'all'>('pending_approval');
  const [data, setData] = useState<{ counts: Record<OrgStatus, number>; organizations: Organization[] }>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<{ org: Organization; decision: Decision }>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(() => {
    api<typeof data>(`/api/admin/organizations${filter === 'all' ? '' : `?status=${filter}`}`)
      .then((d) => {
        setData(d);
        setError(undefined);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [filter]);
  useEffect(load, [load]);

  const decide = async () => {
    if (!pending) return;
    const needsReason = DECISION_VIEW[pending.decision].reason;
    if (needsReason && !reason.trim()) return setDialogError('Give a reason; it is sent to the owners.');
    setBusy(true);
    setDialogError(undefined);
    try {
      await api(`/api/admin/organizations/${pending.org.id}/decisions`, {
        method: 'POST',
        csrf: session.csrfToken,
        body: { decision: pending.decision, ...(needsReason ? { reason: reason.trim() } : {}) },
      });
      setNotice(`${pending.org.name}: ${PAST[pending.decision]}. The owners are being emailed.`);
      setPending(undefined);
      load();
    } catch (e) {
      setDialogError(
        e instanceof ApiError && e.code === 'invalid_transition'
          ? 'The organization changed in the meantime (perhaps another Super Admin decided). The list has been refreshed.'
          : errorMessage(e),
      );
      if (e instanceof ApiError && e.code === 'invalid_transition') load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Super Admin</span>
          <h1>Organizations</h1>
          <p>
            Approve new organizations, and suspend or reinstate existing ones. Every decision is recorded.
          </p>
        </div>
      </div>
      <nav className="admin-filters" aria-label="Filter organizations">
        {FILTERS.map((f) => (
          <button
            key={f.status}
            type="button"
            aria-pressed={filter === f.status}
            onClick={() => {
              setFilter(f.status);
              setNotice(undefined);
            }}
          >
            {f.label}
            {f.status !== 'all' && data && <span className="tab-count">{data.counts[f.status]}</span>}
          </button>
        ))}
      </nav>
      {notice && <Alert kind="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}
      {!data ? (
        <PageSkeleton />
      ) : data.organizations.length === 0 ? (
        <Empty
          title="Nothing here"
          text="No organization is in this state."
          icon={<Building2 size={28} aria-hidden="true" />}
        />
      ) : (
        <div className="admin-list">
          {data.organizations.map((org) => (
            <OrganizationCard
              key={org.id}
              org={org}
              onDecide={(o, d) => {
                setPending({ org: o, decision: d });
                setReason('');
                setDialogError(undefined);
              }}
            />
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!pending}
        title={pending ? DECISION_VIEW[pending.decision].title : ''}
        confirmLabel={pending ? DECISION_VIEW[pending.decision].label : ''}
        cancelLabel="Cancel"
        destructive={pending ? DECISION_VIEW[pending.decision].destructive : false}
        busy={busy}
        onConfirm={decide}
        onClose={() => setPending(undefined)}
      >
        {pending && (
          <>
            <p>
              <strong>{pending.org.name}</strong>. {DECISION_VIEW[pending.decision].text}
            </p>
            {DECISION_VIEW[pending.decision].reason && (
              <Field label="Reason (sent to the owners)">
                {(id) => (
                  <textarea
                    id={id}
                    className="textarea"
                    rows={3}
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                )}
              </Field>
            )}
            {dialogError && <Alert>{dialogError}</Alert>}
          </>
        )}
      </ConfirmDialog>
    </>
  );
}

function AdminApp() {
  const [session, setSession] = useState<AdminSession | null>();
  useEffect(() => {
    api<AdminSession>('/api/admin/session')
      .then(setSession)
      .catch(() => setSession(null));
  }, []);
  if (session === undefined)
    return (
      <Shell>
        <PageSkeleton />
      </Shell>
    );
  if (session === null) return <SignIn />;
  const signOut = () =>
    void api('/api/admin/sign-out', { method: 'POST', csrf: session.csrfToken })
      .catch(() => undefined)
      .then(() => window.location.assign('/admin'));
  return (
    <Shell session={session} onSignOut={signOut}>
      <Organizations session={session} />
    </Shell>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);
