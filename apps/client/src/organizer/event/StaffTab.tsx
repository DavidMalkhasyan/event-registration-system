import { useCallback, useEffect, useState } from 'react';
import { MailPlus, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '../../shared/api';
import { Alert, Button, Empty, Field, SectionHeading, Status } from '../../shared/ui';
import { RefreshControl } from '../RefreshControl';
import type { EventItem, Notice, Session } from '../types';
import { useAutoRefresh } from '../use-auto-refresh';

interface StaffOverview {
  invitations: {
    id: string;
    email: string;
    status: string;
    createdAt: string;
    expiresAt: string;
    acceptedAt?: string;
    canReinvite: boolean;
  }[];
  sessions: { id: string; createdAt: string; lastSeenAt: string }[];
}

const INVITATION_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Invited', tone: 'pending' },
  accepted: { label: 'Accepted', tone: 'accepted' },
  expired: { label: 'Expired', tone: 'expired' },
  revoked: { label: 'Revoked', tone: 'revoked' },
  replaced: { label: 'Replaced', tone: 'replaced' },
};

/** Staff invitations and device sessions of this event (FR-STAFF-1, FR-STAFF-3, FR-STAFF-5 to FR-STAFF-7). */
export function StaffTab({
  session,
  event,
  active,
}: {
  session: Session;
  event: EventItem;
  active: boolean;
}) {
  const [overview, setOverview] = useState<StaffOverview>();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<Notice>();
  // K-704: invitations and device sessions refresh in place, every 15 s while this section is shown.
  const fetchStaff = useCallback(
    async (signal: AbortSignal) =>
      setOverview(await api<StaffOverview>(`/api/events/${event.id}/staff`, { signal })),
    [event.id],
  );
  // Polls only while the section is shown (K-706 keeps it mounted when hidden); refreshed when shown again.
  const refresher = useAutoRefresh(fetchStaff, event.status === 'SCHEDULED' && active);
  const load = refresher.refresh;
  useEffect(() => {
    if (active) load();
  }, [active, load]);
  if (event.status !== 'SCHEDULED')
    return <Alert kind="info">Staff access ended when this event was cancelled.</Alert>;

  const act = async (path: string, body: unknown, done: string) => {
    setMessage(undefined);
    try {
      await api(path, { method: 'POST', csrf: session.csrfToken, ...(body ? { body } : {}) });
      setMessage({ kind: 'success', text: done });
      load();
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) });
    }
  };
  const invite = (address: string) =>
    act(`/api/events/${event.id}/staff-invitations`, { email: address }, `Invitation sent to ${address}.`);

  return (
    <div>
      <div className="tab-toolbar">
        <RefreshControl state={refresher} label="Refresh staff" />
      </div>
      <SectionHeading
        title="Event staff"
        description="Staff can only check tickets in and see the checked-in count, for this event, during the check-in window. Each invitation link works once, on one device, and expires after 7 days."
      />
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void invite(email).then(() => setEmail(''));
        }}
      >
        <Field label="Staff email address">
          {(id) => (
            <input
              id={id}
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
            />
          )}
        </Field>
        <Button type="submit">
          <MailPlus aria-hidden="true" />
          Send invitation
        </Button>
      </form>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}

      <div className="section-block">
        <h3>Invitations</h3>
        {!overview || overview.invitations.length === 0 ? (
          <p className="muted">No invitations yet.</p>
        ) : (
          overview.invitations.map((i) => {
            const s = INVITATION_STATUS[i.status] ?? { label: i.status, tone: 'neutral' };
            return (
              <div className="staff-row" key={i.id}>
                <span className="person-avatar" aria-hidden="true">
                  {i.email.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <strong>{i.email}</strong>
                  <p>
                    {i.acceptedAt
                      ? `Accepted ${new Date(i.acceptedAt).toLocaleString()}`
                      : `Sent ${new Date(i.createdAt).toLocaleString()} · expires ${new Date(i.expiresAt).toLocaleDateString()}`}
                  </p>
                </div>
                <Status tone={s.tone}>{s.label}</Status>
                {i.status === 'pending' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      act(
                        `/api/events/${event.id}/staff-invitations/${i.id}/revocation`,
                        null,
                        'Invitation revoked.',
                      )
                    }
                  >
                    Revoke
                  </Button>
                )}
                {i.canReinvite && (
                  <Button variant="outline" size="sm" onClick={() => invite(i.email)}>
                    Re-invite
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="section-block">
        <h3>Active staff devices</h3>
        {!overview || overview.sessions.length === 0 ? (
          <Empty
            icon={<MonitorSmartphone size={26} aria-hidden="true" />}
            title="No devices yet"
            text="A device appears here when someone accepts an invitation on it."
          />
        ) : (
          overview.sessions.map((d) => (
            <div className="staff-row" key={d.id}>
              <span className="activity-icon" aria-hidden="true">
                <MonitorSmartphone size={16} />
              </span>
              <div>
                <strong>Check-in device</strong>
                <p>
                  Since {new Date(d.createdAt).toLocaleString()} · last seen{' '}
                  {new Date(d.lastSeenAt).toLocaleTimeString()}
                </p>
              </div>
              <Status tone="active">Active</Status>
              <Button
                variant="destructive"
                size="sm"
                onClick={() =>
                  act(
                    `/api/events/${event.id}/staff-sessions/${d.id}/revocation`,
                    null,
                    'Staff access revoked.',
                  )
                }
              >
                Revoke access
              </Button>
            </div>
          ))
        )}
      </div>
      <p className="check-in-note">
        <ShieldCheck size={15} aria-hidden="true" />
        Staff never see participant emails, event settings or check-in undo.
      </p>
    </div>
  );
}
