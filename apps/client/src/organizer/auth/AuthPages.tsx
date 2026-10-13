import { useState, type FormEvent, type ReactNode } from 'react';
import { Building2, Clock3, KeyRound, Mail, ShieldAlert } from 'lucide-react';
import { ApiError, api, errorMessage } from '../../shared/api';
import { Alert, Button, DevMailboxHint, Field, Logo } from '../../shared/ui';
import { Link } from '../router';
import type { Session } from '../types';

// Organizer accounts (K-709, PD-89): password sign-in, organization registration, password reset, and
// the emailed sign-in link kept for organizers from before K-709 who have not set a password yet.
// Participants never see these pages: they register for events with their email address only.

const PASSWORD_MIN = 12;

function AuthShell({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  return (
    <div className="center-shell">
      <header>
        <Logo />
        <span className="staff-label">ORGANIZER WORKSPACE</span>
      </header>
      <main className="center-card auth-card">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}

function EmailField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Email address">
      {(id) => (
        <input
          id={id}
          className="input"
          type="email"
          required
          maxLength={254}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
        />
      )}
    </Field>
  );
}

function Sent({ children }: { children: ReactNode }) {
  return (
    <>
      <span className="result-icon">
        <Mail aria-hidden="true" />
      </span>
      <Alert kind="success">{children}</Alert>
      <DevMailboxHint />
    </>
  );
}

/** Password sign-in (the default organizer entry). */
export function PasswordSignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api('/api/auth/password-sessions', { method: 'POST', body: { email, password } });
      // A full page load: the new session brings its anti-forgery token (ADR-010 §8).
      window.location.assign('/organizer');
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'invalid_credentials'
          ? 'The email address or password is not correct.'
          : err instanceof ApiError && err.code === 'email_verification_required'
            ? 'Confirm your email address first: open the link we sent when you registered. You can get a new one with “Forgot your password?”.'
            : errorMessage(err),
      );
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Organizer sign-in" eyebrow="Good things happen together">
      <form className="stack" onSubmit={submit}>
        <EmailField value={email} onChange={setEmail} />
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
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      {error && <Alert>{error}</Alert>}
      <nav className="auth-links" aria-label="Account options">
        <Link to="/organizer/forgot-password">Forgot your password?</Link>
        <Link to="/organizer/register">Register your organization</Link>
        <Link to="/organizer/sign-in-link">No password yet? Get a sign-in link by email</Link>
      </nav>
    </AuthShell>
  );
}

/** Organization registration: verified by email, then approved by a Super Admin before events can be created. */
export function RegisterOrganization() {
  const [form, setForm] = useState({
    organizationName: '',
    contactName: '',
    email: '',
    password: '',
    confirm: '',
    description: '',
  });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) return setError('The two passwords are not the same.');
    setBusy(true);
    setError(undefined);
    try {
      const { confirm: _confirm, description, ...rest } = form;
      void _confirm;
      await api('/api/organizations/registrations', {
        method: 'POST',
        body: { ...rest, ...(description.trim() ? { description: description.trim() } : {}) },
      });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (sent)
    return (
      <AuthShell title="Check your email" eyebrow="Register your organization">
        <Sent>
          We sent a link to <strong>{form.email}</strong> to confirm the address. After you confirm it, your
          registration waits for approval; we email you when it is decided. If the address already has an
          account, we sent it a note instead.
        </Sent>
        <p className="auth-links">
          <Link to="/organizer">Back to sign-in</Link>
        </p>
      </AuthShell>
    );
  return (
    <AuthShell title="Register your organization" eyebrow="For organizers">
      <p>
        Organizations are approved before they can publish events. Participants never need an account: they
        register for events with their email address.
      </p>
      <form className="stack" onSubmit={submit}>
        <Field label="Organization name">
          {(id) => (
            <input
              id={id}
              className="input"
              required
              maxLength={200}
              value={form.organizationName}
              onChange={(e) => set({ organizationName: e.target.value })}
              autoComplete="organization"
            />
          )}
        </Field>
        <Field label="Contact person">
          {(id) => (
            <input
              id={id}
              className="input"
              required
              maxLength={200}
              value={form.contactName}
              onChange={(e) => set({ contactName: e.target.value })}
              autoComplete="name"
            />
          )}
        </Field>
        <EmailField value={form.email} onChange={(email) => set({ email })} />
        <Field label="Password" hint={`At least ${PASSWORD_MIN} characters.`}>
          {(id) => (
            <input
              id={id}
              className="input"
              type="password"
              required
              minLength={PASSWORD_MIN}
              maxLength={128}
              value={form.password}
              onChange={(e) => set({ password: e.target.value })}
              autoComplete="new-password"
            />
          )}
        </Field>
        <Field label="Confirm password">
          {(id) => (
            <input
              id={id}
              className="input"
              type="password"
              required
              aria-invalid={mismatch || undefined}
              value={form.confirm}
              onChange={(e) => set({ confirm: e.target.value })}
              autoComplete="new-password"
            />
          )}
        </Field>
        {mismatch && <p className="field-error">The two passwords are not the same.</p>}
        <Field label="About the organization (optional)">
          {(id) => (
            <textarea
              id={id}
              className="textarea"
              rows={3}
              maxLength={2000}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          )}
        </Field>
        <Button type="submit" size="lg" disabled={busy || mismatch}>
          {busy ? 'Registering…' : 'Register'}
        </Button>
      </form>
      {error && <Alert>{error}</Alert>}
      <p className="auth-links">
        <Link to="/organizer">Already registered? Sign in</Link>
      </p>
    </AuthShell>
  );
}

/** Password reset request (also how organizers from before K-709 set a first password). */
export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api('/api/auth/password-reset-requests', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Set a new password" eyebrow="Organizer account">
      {sent ? (
        <Sent>
          If <strong>{email}</strong> has an organizer account, we sent it a link to set a new password. It
          works once and expires 15 minutes after it was sent.
        </Sent>
      ) : (
        <>
          <p>
            We email you a link to set a new password. Organizers without a password yet can set one here too.
          </p>
          <form className="stack" onSubmit={submit}>
            <EmailField value={email} onChange={setEmail} />
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? 'Sending…' : 'Email me a link'}
            </Button>
          </form>
        </>
      )}
      {error && <Alert>{error}</Alert>}
      <p className="auth-links">
        <Link to="/organizer">Back to sign-in</Link>
      </p>
    </AuthShell>
  );
}

/** Emailed sign-in link (FR-ORG-3): only for existing organizer accounts that have no password yet. */
export function SignInLinkRequest() {
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
    <AuthShell title="Sign in with an emailed link" eyebrow="Organizers without a password">
      {sent ? (
        <Sent>
          Check your email for a sign-in link. It expires 15 minutes after you requested it and works once.
          Links are sent only to existing organizer accounts that have no password yet.
        </Sent>
      ) : (
        <>
          <p>
            For organizer accounts created before passwords existed. After signing in, set a password with
            “Forgot your password?”.
          </p>
          <form className="stack" onSubmit={submit}>
            <EmailField value={email} onChange={setEmail} />
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? 'Sending…' : 'Send sign-in link'}
            </Button>
          </form>
        </>
      )}
      {error && <Alert>{error}</Alert>}
      <p className="auth-links">
        <Link to="/organizer">Back to sign-in</Link>
      </p>
    </AuthShell>
  );
}

const STATUS: Record<string, { icon: ReactNode; title: string; text: string }> = {
  pending_verification: {
    icon: <Mail aria-hidden="true" />,
    title: 'Email verification required',
    text: 'Open the link we sent to your email address to confirm it. Then your registration goes to approval.',
  },
  pending_approval: {
    icon: <Clock3 aria-hidden="true" />,
    title: 'Awaiting approval',
    text: 'Your organization is registered and waits for approval. We email you when it is decided. Until then you can’t create or manage events.',
  },
  rejected: {
    icon: <ShieldAlert aria-hidden="true" />,
    title: 'Registration not approved',
    text: 'Your organization’s registration was not approved, so it can’t create or manage events.',
  },
  suspended: {
    icon: <ShieldAlert aria-hidden="true" />,
    title: 'Access suspended',
    text: 'Your organization’s access to event management is suspended. Its public event pages are not affected.',
  },
};

/** A signed-in account without an active organization sees where its registration stands. */
export function OrganizationStatus({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const org = session.organizations[0];
  const status = org ? STATUS[org.status] : undefined;
  return (
    <AuthShell title={status?.title ?? 'No organization'} eyebrow={org?.name ?? session.email}>
      <span className="result-icon">{status?.icon ?? <Building2 aria-hidden="true" />}</span>
      <p>
        {status?.text ??
          'This account does not belong to an active organization. Register an organization, or ask an organization’s owner to add you.'}
      </p>
      {!session.hasPassword && (
        <Alert kind="info">
          <KeyRound size={15} aria-hidden="true" /> Your account has no password yet. Set one with “Forgot
          your password?” on the sign-in page.
        </Alert>
      )}
      <Button variant="outline" onClick={onSignOut}>
        Sign out
      </Button>
    </AuthShell>
  );
}
