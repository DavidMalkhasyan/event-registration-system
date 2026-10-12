import { useState, type FormEvent } from 'react';
import { Mail } from 'lucide-react';
import { api, errorMessage } from '../../shared/api';
import { Alert, Button, DevMailboxHint, Field, Logo } from '../../shared/ui';

/** Passwordless organizer sign-in (FR-ORG-3, ADR-010): a link is emailed; no password exists. */
export function SignInRequest() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api('/api/auth/sign-in-requests', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="center-shell">
      <header>
        <Logo />
        <span className="staff-label">ORGANIZER WORKSPACE</span>
      </header>
      <main className="center-card">
        <span className="eyebrow">Good things happen together</span>
        <h1>Organizer sign-in</h1>
        {sent ? (
          <>
            <span className="result-icon">
              <Mail aria-hidden="true" />
            </span>
            <Alert kind="success">
              Check your email for a sign-in link. It expires 15 minutes after you requested it and works
              once.
            </Alert>
          </>
        ) : (
          <>
            <p>
              Sign in or create your organizer account with a link sent to your email address. No password
              needed.
            </p>
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
                    autoComplete="email"
                    placeholder="you@example.com"
                  />
                )}
              </Field>
              <Button type="submit" size="lg" disabled={busy}>
                {busy ? 'Sending…' : 'Send sign-in link'}
              </Button>
            </form>
          </>
        )}
        {error && <Alert>{error}</Alert>}
        <DevMailboxHint />
      </main>
    </div>
  );
}
