import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '../../shared/api';
import { saveReturnTo } from '../../shared/return-to';
import { Alert, Button } from '../../shared/ui';
import type { Session } from '../types';

/**
 * Re-authentication (FR-ORG-5, AC-149): protected actions such as cancelling or deleting an event
 * need a sign-in confirmed within the last 15 minutes. The emailed link only signs in again; the
 * organizer comes back to this page (organizer paths only, return-to.ts) and confirms again.
 */
export function ReauthPrompt({ session, intro }: { session: Session; intro: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string>();
  const send = async () => {
    setState('sending');
    setError(undefined);
    try {
      saveReturnTo(window.location.pathname);
      await api('/api/auth/reauthentication', { method: 'POST', csrf: session.csrfToken });
      setState('sent');
    } catch (err) {
      setError(errorMessage(err));
      setState('idle');
    }
  };
  if (state === 'sent')
    return (
      <Alert kind="info">
        We emailed a confirmation link to {session.email}. Opening it signs you in again and brings you back
        here; it does not cancel, delete or change anything. Then confirm the action again.
      </Alert>
    );
  return (
    <div className="stack">
      <p>{intro}</p>
      <div>
        <Button variant="outline" onClick={send} disabled={state === 'sending'}>
          <ShieldCheck aria-hidden="true" />
          {state === 'sending' ? 'Sending…' : 'Confirm it’s you'}
        </Button>
      </div>
      {error && <Alert>{error}</Alert>}
    </div>
  );
}

/** Shows whether the sign-in still counts as recent (display only; the server decides). */
export function RecentSignIn({ session }: { session: Session }) {
  const until = new Date(session.recentAuthUntil);
  // Re-evaluated every 30 s, so the text changes when the 15 minutes run out.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (until.getTime() > now)
    return (
      <p className="muted">
        Protected actions, such as cancelling or deleting an event, need a sign-in within the last 15 minutes.
        Your sign-in counts as recent until {until.toLocaleTimeString()}.
      </p>
    );
  return (
    <ReauthPrompt
      session={session}
      intro="Your last sign-in was more than 15 minutes ago. Protected actions, such as cancelling or deleting an event, need you to confirm it’s you first."
    />
  );
}
