import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { api, errorMessage } from '../../shared/api';
import { Alert, Button, formatLocal } from '../../shared/ui';
import { ROLE_LABEL, type Session } from '../types';

// K-716 (PD-94): invitations into organizations, for the signed-in account's verified address. Accepting
// or declining reloads the organizer area, so the new membership is used everywhere at once.

export function Invitations({ session }: { session: Session }) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  if (session.invitations.length === 0) return null;
  const answer = async (id: string, what: 'accept' | 'decline') => {
    setBusy(id);
    setError(undefined);
    try {
      await api(`/api/invitations/${id}/${what}`, { method: 'POST', csrf: session.csrfToken });
      window.location.assign('/organizer');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(undefined);
    }
  };
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return (
    <section className="invitations" aria-label="Invitations">
      {session.invitations.map((i) => (
        <div key={i.id} className="invitation">
          <Building2 aria-hidden="true" />
          <p>
            <strong>{i.invitedBy ?? 'An organizer'}</strong> invited you to join{' '}
            <strong>{i.organizationName}</strong> as {ROLE_LABEL[i.role].toLowerCase()}.{' '}
            <small>Expires {formatLocal(i.expiresAt, zone)}.</small>
          </p>
          <div className="invitation-actions">
            <Button size="sm" disabled={!!busy} onClick={() => void answer(i.id, 'accept')}>
              Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              onClick={() => void answer(i.id, 'decline')}
            >
              Decline
            </Button>
          </div>
        </div>
      ))}
      {error && <Alert>{error}</Alert>}
    </section>
  );
}
