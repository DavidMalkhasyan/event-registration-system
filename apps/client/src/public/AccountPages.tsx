import { useEffect, useState, type FormEvent } from 'react';
import { CircleCheck, KeyRound, MailCheck } from 'lucide-react';
import { ApiError, api, errorMessage } from '../shared/api';
import { Alert, Button, Field } from '../shared/ui';
import { linkToken } from './bootstrap-token';
import { CenterPage, InvalidLinkPage, LoadingPage } from './shell';

// Organizer account links (K-709, PD-89), on the link entry with its token bootstrap (FR-LNK-10): the
// token stays in memory and goes only in "Authorization: Link". Opening a link changes nothing; the
// explicit button does (FR-LNK-9).

interface AccountLinkView {
  maskedEmail: string;
  organizationName: string | null;
}

function useAccountLink(path: string) {
  const token = linkToken();
  const [view, setView] = useState<AccountLinkView>();
  const [invalid, setInvalid] = useState(!token);
  useEffect(() => {
    if (!token) return;
    api<AccountLinkView>(path, { linkToken: token })
      .then(setView)
      .catch(() => setInvalid(true));
  }, [token, path]);
  return { token, view, invalid, setInvalid };
}

/** /verify-account: confirms the organizer's address; the organization then waits for approval. */
export function AccountVerificationPage() {
  const { token, view, invalid, setInvalid } = useAccountLink('/api/links/account-verification');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const confirm = async () => {
    setBusy(true);
    try {
      await api('/api/links/account-verification/confirm', { method: 'POST', linkToken: token });
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'invalid_link') setInvalid(true);
      else setError(errorMessage(e));
    }
    setBusy(false);
  };
  if (invalid) return <InvalidLinkPage />;
  if (!view) return <LoadingPage />;
  return (
    <CenterPage>
      <section className="center-card">
        <span className="result-icon">
          {done ? <CircleCheck aria-hidden="true" /> : <MailCheck aria-hidden="true" />}
        </span>
        {done ? (
          <>
            <h1>Email address confirmed</h1>
            <p>
              {view.organizationName ? <strong>{view.organizationName}</strong> : 'Your organization'} now
              waits for approval. We email you when it is decided; you can sign in meanwhile to see its
              status.
            </p>
            <a className="btn btn-lg btn-block" href="/organizer">
              Go to sign-in
            </a>
          </>
        ) : (
          <>
            <h1>Confirm your email address</h1>
            <p>
              Confirm <strong>{view.maskedEmail}</strong>
              {view.organizationName ? (
                <>
                  {' '}
                  for <strong>{view.organizationName}</strong>
                </>
              ) : null}
              ?
            </p>
            <Button size="lg" className="btn-block" onClick={confirm} disabled={busy}>
              {busy ? 'Confirming…' : 'Confirm my email address'}
            </Button>
          </>
        )}
        {error && <Alert>{error}</Alert>}
      </section>
    </CenterPage>
  );
}

/** /reset-password: sets a new password; every signed-in device is signed out. */
export function PasswordResetPage() {
  const { token, view, invalid, setInvalid } = useAccountLink('/api/links/password-reset');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const mismatch = confirmation.length > 0 && confirmation !== password;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirmation) return;
    setBusy(true);
    setError(undefined);
    try {
      await api('/api/links/password-reset/confirm', {
        method: 'POST',
        linkToken: token,
        body: { password },
      });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_link') setInvalid(true);
      else setError(errorMessage(err));
    }
    setBusy(false);
  };
  if (invalid) return <InvalidLinkPage />;
  if (!view) return <LoadingPage />;
  return (
    <CenterPage>
      <section className="center-card">
        <span className="result-icon">
          {done ? <CircleCheck aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
        </span>
        {done ? (
          <>
            <h1>Password changed</h1>
            <p>
              Every device that was signed in to your account has been signed out. Sign in with your new
              password.
            </p>
            <a className="btn btn-lg btn-block" href="/organizer">
              Go to sign-in
            </a>
          </>
        ) : (
          <>
            <h1>Set a new password</h1>
            <p>
              For the organizer account <strong>{view.maskedEmail}</strong>. At least 12 characters.
            </p>
            <form className="stack" onSubmit={submit}>
              <Field label="New password">
                {(id) => (
                  <input
                    id={id}
                    className="input"
                    type="password"
                    required
                    minLength={12}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                )}
              </Field>
              <Field label="Confirm new password">
                {(id) => (
                  <input
                    id={id}
                    className="input"
                    type="password"
                    required
                    aria-invalid={mismatch || undefined}
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    autoComplete="new-password"
                  />
                )}
              </Field>
              {mismatch && <p className="field-error">The two passwords are not the same.</p>}
              <Button type="submit" size="lg" className="btn-block" disabled={busy || mismatch}>
                {busy ? 'Saving…' : 'Set new password'}
              </Button>
            </form>
          </>
        )}
        {error && <Alert>{error}</Alert>}
      </section>
    </CenterPage>
  );
}
