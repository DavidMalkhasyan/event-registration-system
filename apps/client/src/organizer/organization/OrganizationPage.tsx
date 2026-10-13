import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LogOut, Mail, UserMinus } from 'lucide-react';
import { ApiError, api, errorMessage } from '../../shared/api';
import { Alert, Button, ConfirmDialog, Field, PageHeader, Status, formatLocal } from '../../shared/ui';
import { ROLE_LABEL, activeOrganizations, type Membership, type Notice, type Session } from '../types';

// Several organizers per organization (K-716, PD-94): the members, their roles, invitations, removal
// and leaving. The server decides every permission; this page only offers what the role allows.

type Role = Membership['role'];

interface Members {
  organization: { id: string; name: string };
  yourRole: Role;
  members: {
    accountId: string;
    email: string;
    name: string | null;
    role: Role;
    since: string;
    you: boolean;
  }[];
  invitations: { id: string; email: string; role: Role; sentAt: string; expiresAt: string }[];
}

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const sinceDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

/** The roles the caller may give to `target` (owners: any; admins: admin or member, never to owners). */
function assignable(you: Role, target: Role): Role[] {
  if (you === 'owner') return ['owner', 'admin', 'member'];
  if (you === 'admin' && target !== 'owner') return ['admin', 'member'];
  return [];
}

const CODE_TEXT: Record<string, string> = {
  last_owner: 'An organization needs at least one owner. Make someone else an owner first.',
  already_member: 'This person is already a member.',
  forbidden: 'Your role does not allow this.',
};
const explain = (err: unknown) =>
  err instanceof ApiError && CODE_TEXT[err.code] ? CODE_TEXT[err.code]! : errorMessage(err);

function OrganizationMembers({ session, organizationId }: { session: Session; organizationId: string }) {
  const [data, setData] = useState<Members>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [removing, setRemoving] = useState<Members['members'][number]>();
  const base = `/api/organizations/${organizationId}`;

  const load = useCallback(() => {
    api<Members>(`${base}/members`)
      .then((d) => {
        setData(d);
        setError(undefined);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [base]);
  useEffect(load, [load]);

  const run = async (work: () => Promise<void>, success: string, after?: () => void) => {
    setBusy(true);
    setNotice(undefined);
    try {
      await work();
      setNotice({ kind: 'success', text: success });
      after?.();
      load();
    } catch (err) {
      setNotice({ kind: 'error', text: explain(err) });
    } finally {
      setBusy(false);
    }
  };

  if (!data) return error ? <Alert>{error}</Alert> : <p className="muted">Loading members…</p>;
  const manager = data.yourRole !== 'member';

  const invite = (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    void run(
      () =>
        api(`${base}/invitations`, {
          method: 'POST',
          csrf: session.csrfToken,
          body: { email: address, role },
        }),
      `Invitation email queued for ${address}. They accept it after signing in with that address.`,
      () => setEmail(''),
    );
  };

  return (
    <div className="stack">
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      <section className="panel">
        <div className="panel-body">
          <h2 className="panel-title">Members</h2>
          {/* A list rather than a table (K-715 review): it wraps on a phone instead of scrolling sideways. */}
          <ul className="member-list">
            {data.members.map((m) => {
              const roles = m.you ? [] : assignable(data.yourRole, m.role);
              const canRemove = m.you || (manager && !(data.yourRole === 'admin' && m.role === 'owner'));
              return (
                <li key={m.accountId}>
                  <div className="member-who">
                    <strong>
                      {m.name ?? m.email}
                      {m.you && ' (you)'}
                    </strong>
                    {m.name && <span>{m.email}</span>}
                    <small>Member since {sinceDate(m.since)}</small>
                  </div>
                  <div className="member-actions">
                    {roles.length > 0 ? (
                      <select
                        className="select select-auto"
                        aria-label={`Role of ${m.name ?? m.email}`}
                        value={m.role}
                        disabled={busy}
                        onChange={(e) => {
                          const next = e.target.value as Role;
                          void run(
                            () =>
                              api(`${base}/members/${m.accountId}`, {
                                method: 'PATCH',
                                csrf: session.csrfToken,
                                body: { role: next },
                              }),
                            `${m.name ?? m.email} is now ${ROLE_LABEL[next].toLowerCase()}.`,
                          );
                        }}
                      >
                        {roles.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Status tone={m.role === 'owner' ? 'accepted' : 'neutral'}>{ROLE_LABEL[m.role]}</Status>
                    )}
                    {canRemove && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRemoving(m)}>
                        {m.you ? (
                          <>
                            <LogOut size={15} aria-hidden="true" /> Leave
                          </>
                        ) : (
                          <>
                            <UserMinus size={15} aria-hidden="true" /> Remove
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {manager && (
        <section className="panel">
          <div className="panel-body stack">
            <h2 className="panel-title">Invite an organizer</h2>
            <p className="muted">
              They get an email. With an organizer account for that address they sign in and accept; without
              one they create an account first. Members organize events; admins also manage members (but not
              owners).
            </p>
            <form className="invite-form" onSubmit={invite}>
              <Field label="Email address">
                {(id) => (
                  <input
                    id={id}
                    className="input"
                    type="email"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Role">
                {(id) => (
                  <select
                    id={id}
                    className="select"
                    value={role}
                    onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                )}
              </Field>
              <Button type="submit" disabled={busy}>
                <Mail size={15} aria-hidden="true" /> Send invitation
              </Button>
            </form>
            {data.invitations.length > 0 && (
              <>
                <h3>Pending invitations</h3>
                <ul className="invitation-list">
                  {data.invitations.map((i) => (
                    <li key={i.id}>
                      <span>
                        <strong>{i.email}</strong> · {ROLE_LABEL[i.role]} · expires{' '}
                        {formatLocal(i.expiresAt, zone())}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              api(`${base}/invitations/${i.id}`, {
                                method: 'DELETE',
                                csrf: session.csrfToken,
                              }),
                            `Invitation for ${i.email} withdrawn.`,
                          )
                        }
                      >
                        Withdraw
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      )}

      <ConfirmDialog
        open={!!removing}
        title={
          removing?.you ? `Leave ${data.organization.name}?` : `Remove ${removing?.name ?? removing?.email}?`
        }
        confirmLabel={removing?.you ? 'Leave' : 'Remove'}
        cancelLabel="Cancel"
        destructive
        busy={busy}
        onConfirm={() => {
          const target = removing!;
          void run(
            () => api(`${base}/members/${target.accountId}`, { method: 'DELETE', csrf: session.csrfToken }),
            target.you
              ? `You left ${data.organization.name}.`
              : `${target.name ?? target.email} was removed.`,
            () => {
              setRemoving(undefined);
              if (target.you) window.location.assign('/organizer');
            },
          );
        }}
        onClose={() => setRemoving(undefined)}
      >
        <p>
          {removing?.you
            ? 'You lose access to its events at once. An owner or admin can invite you again.'
            : 'They lose access to the organization’s events at once. Their past actions stay in the records.'}
        </p>
      </ConfirmDialog>
    </div>
  );
}

export function OrganizationPage({ session }: { session: Session }) {
  const organizations = activeOrganizations(session);
  const [chosen, setChosen] = useState(organizations[0]?.organizationId);
  const current = organizations.find((o) => o.organizationId === chosen) ?? organizations[0];
  return (
    <>
      <PageHeader
        eyebrow={current ? `${ROLE_LABEL[current.role]} of` : undefined}
        title={current?.name ?? 'Organization'}
        description="The organizers of this organization share its events."
        actions={
          organizations.length > 1 ? (
            <select
              className="select select-auto"
              aria-label="Organization"
              value={current?.organizationId}
              onChange={(e) => setChosen(e.target.value)}
            >
              {organizations.map((o) => (
                <option key={o.organizationId} value={o.organizationId}>
                  {o.name}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />
      {current && (
        <OrganizationMembers
          key={current.organizationId}
          session={session}
          organizationId={current.organizationId}
        />
      )}
    </>
  );
}
