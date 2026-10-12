import { useEffect, useState } from 'react';
import { Clock3, Mail, RefreshCw, Share2 } from 'lucide-react';
import { linkToken, replaceLinkToken } from './bootstrap-token';
import { ApiError, api, errorMessage } from '../shared/api';
import { Alert, Button, ConfirmDialog, CopyLink } from '../shared/ui';
import { CenterPage, InvalidLinkPage, LoadingPage, TicketCard, type EventSummary } from './shell';

type ManageView =
  | {
      state: 'CONFIRMED';
      event: EventSummary;
      ticket: { code: string };
      checkedIn: boolean;
      actions: { cancel: boolean };
    }
  | { state: 'WAITLISTED'; event: EventSummary; position: number; actions: { cancel: boolean } };

const tokenOf = (link: string) => link.split('#t=')[1] ?? '';

/** Ticket resend (FR-SELF-4) and share-link issuance (FR-SHR-1) for a confirmed registration. */
function TicketActions({ token }: { token: string }) {
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [shareLink, setShareLink] = useState<string>();
  const [error, setError] = useState<string>();
  const requestResend = async () => {
    setResend('sending');
    setError(undefined);
    const requestId = crypto.randomUUID(); // a retry reuses it, so it can't create a second email
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await api('/api/links/manage/resend', { method: 'POST', linkToken: token, body: { requestId } });
        setResend('sent');
        return;
      } catch (e) {
        if (!(e instanceof ApiError && e.code === 'network_error') || attempt === 1) {
          setError(errorMessage(e));
          setResend('idle');
          return;
        }
      }
    }
  };
  const issueShareLink = async () => {
    setError(undefined);
    try {
      setShareLink(
        (
          await api<{ shareLink: string }>('/api/links/manage/share-links', {
            method: 'POST',
            linkToken: token,
          })
        ).shareLink,
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <>
      <Button variant="outline" className="btn-start" onClick={requestResend} disabled={resend !== 'idle'}>
        <Mail aria-hidden="true" />
        {resend === 'sending'
          ? 'Sending…'
          : resend === 'sent'
            ? 'Ticket email sent'
            : 'Email me my ticket again'}
      </Button>
      {resend === 'sent' && (
        <Alert kind="success">We sent your ticket to your email address again. It contains new links.</Alert>
      )}
      <Button variant="outline" className="btn-start" onClick={issueShareLink}>
        <Share2 aria-hidden="true" />
        Share ticket
      </Button>
      {shareLink && (
        <>
          <CopyLink label="Share link (pass on only the ticket)" url={shareLink} />
          <p className="muted">
            Whoever has this link can see and use the ticket once. It cannot manage or cancel your
            registration.
          </p>
        </>
      )}
      {error && <Alert>{error}</Alert>}
    </>
  );
}

const ROTATION_TEXT = {
  management:
    'All earlier management links, including the ones in earlier emails, stop working immediately. Your share links are not affected. We will email you the new management link.',
  share:
    'All earlier share links, including the ones in earlier emails, stop working immediately. Your management link is not affected. The ticket code itself does not change, so anyone who already saw the code or QR code can still use it once.',
} as const;

/** Link rotation (FR-ROT-1 to FR-ROT-11): explicit confirmation, a fresh request ID per confirmation. */
function LinkRotation({
  token,
  confirmed,
  onManagementRotated,
}: {
  token: string;
  confirmed: boolean;
  onManagementRotated: (next: string) => void;
}) {
  const [linkType, setLinkType] = useState<'management' | 'share' | null>(null);
  const [requestId, setRequestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ linkType: 'management' | 'share'; newLink: string }>();
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string }>();
  const open = (type: 'management' | 'share') => {
    setLinkType(type);
    setRequestId(crypto.randomUUID()); // FR-ROT-11: every confirmation step has a fresh request ID
    setIssued(undefined);
    setMessage(undefined);
  };
  const rotate = async () => {
    if (!linkType) return;
    setBusy(true);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await api<
          | { result: 'rotated'; linkType: 'management' | 'share'; newLink: string }
          | { result: 'already_replaced' }
        >('/api/links/manage/rotations', {
          method: 'POST',
          linkToken: token,
          body: { linkType, requestId, confirmed: true },
        });
        if (result.result === 'already_replaced') {
          setMessage({
            kind: 'info',
            text: 'Your link was already replaced. The new link has been sent to your email address.',
          });
        } else {
          setIssued({ linkType: result.linkType, newLink: result.newLink });
          if (result.linkType === 'management') onManagementRotated(tokenOf(result.newLink));
        }
        setLinkType(null);
        break;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'network_error' && attempt === 0) continue; // same request ID
        if (e instanceof ApiError && e.code === 'request_already_processed')
          setRequestId(crypto.randomUUID());
        setMessage({
          kind: 'error',
          text:
            e instanceof ApiError && e.code === 'rotation_not_applied'
              ? 'Your link was not changed. Your current link still works. Please try again.'
              : errorMessage(e),
        });
        setLinkType(null);
        break;
      }
    }
    setBusy(false);
  };
  return (
    <div className="manage-secondary">
      <p className="muted">
        If you shared or forwarded a link by mistake, replace it. Each link type is replaced separately.
      </p>
      <Button variant="ghost" className="btn-start" onClick={() => open('management')}>
        <RefreshCw aria-hidden="true" />
        Replace management link…
      </Button>
      {confirmed && (
        <Button variant="ghost" className="btn-start" onClick={() => open('share')}>
          <RefreshCw aria-hidden="true" />
          Replace share link…
        </Button>
      )}
      <ConfirmDialog
        open={linkType !== null}
        title={linkType === 'share' ? 'Replace your share link?' : 'Replace your management link?'}
        confirmLabel={
          busy
            ? 'Replacing…'
            : linkType === 'share'
              ? 'Yes, replace my share link'
              : 'Yes, replace my management link'
        }
        cancelLabel="Keep my links"
        busy={busy}
        onConfirm={rotate}
        onClose={() => setLinkType(null)}
      >
        <p>{linkType ? ROTATION_TEXT[linkType] : ''}</p>
      </ConfirmDialog>
      {issued && (
        <>
          <Alert kind="success">
            {issued.linkType === 'management'
              ? 'Your management link was replaced. This page now uses the new link; copy it now, it is shown only once. We also emailed it to you.'
              : 'Your share link was replaced. Copy the new one now; it is shown only once.'}
          </Alert>
          <CopyLink
            label={issued.linkType === 'management' ? 'Your new management link' : 'Your new share link'}
            url={issued.newLink}
          />
        </>
      )}
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
    </div>
  );
}

/** The management link page (FR-SELF-1 to FR-SELF-4): the participant's own registration. */
export function ManagePage() {
  const [token, setToken] = useState(linkToken());
  const [view, setView] = useState<ManageView>();
  const [invalid, setInvalid] = useState(!token);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelled, setCancelled] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!token) return;
    api<ManageView>('/api/links/manage', { linkToken: token })
      .then(setView)
      .catch((e: unknown) =>
        e instanceof ApiError && e.code === 'invalid_link' ? setInvalid(true) : setError(errorMessage(e)),
      );
  }, [token]);

  const cancel = async () => {
    setBusy(true);
    try {
      const response = await api<{ previousState: string }>('/api/links/manage/cancel', {
        method: 'POST',
        linkToken: token,
        body: { confirmed: true },
      });
      setCancelled(response.previousState);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'invalid_link') setInvalid(true);
      else setError(errorMessage(e));
    }
    setBusy(false);
    setConfirming(false);
  };

  if (cancelled)
    return (
      <CenterPage>
        <section className="center-card">
          <h1>Registration cancelled</h1>
          <p>
            {cancelled === 'CONFIRMED'
              ? 'Your registration is cancelled and your ticket is no longer valid.'
              : 'You have left the waiting list.'}
          </p>
          <p className="muted">A confirmation email is on its way. This management link no longer works.</p>
        </section>
      </CenterPage>
    );
  if (invalid) return <InvalidLinkPage />;
  if (!view)
    return error ? (
      <CenterPage>
        <section className="center-card">
          <h1>Your registration</h1>
          <Alert>{error}</Alert>
        </section>
      </CenterPage>
    ) : (
      <LoadingPage />
    );

  const confirmedView = view.state === 'CONFIRMED';
  return (
    <CenterPage wide>
      <div className="management-heading">
        <span className="eyebrow">{confirmedView ? 'You’re on the list' : 'Your registration'}</span>
        <h1>{confirmedView ? 'See you there.' : 'Good things are worth the wait.'}</h1>
        <p>
          {confirmedView ? (
            <>
              Status: <strong>confirmed</strong>
              {view.checkedIn && ' · checked in'}
            </>
          ) : (
            <>
              Status: <strong>waiting list</strong>, current position <strong>{view.position}</strong>. This
              position can change.
            </>
          )}
        </p>
      </div>
      <div className="management-grid">
        {confirmedView ? (
          <TicketCard
            event={view.event}
            status={
              view.checkedIn
                ? { tone: 'started', label: 'Checked in' }
                : { tone: 'confirmed', label: 'Confirmed' }
            }
            code={view.ticket.code}
          />
        ) : (
          <TicketCard
            event={view.event}
            status={{ tone: 'waiting', label: `Waiting list · #${view.position}` }}
            note={
              <>
                <Clock3 aria-hidden="true" />
                <p>
                  Your ticket will appear here and in your email if a seat becomes free before registration
                  closes.
                </p>
              </>
            }
          />
        )}
        <aside className="panel manage-actions" aria-label="Manage your registration">
          <h2>A few useful things</h2>
          {confirmedView && token && <TicketActions token={token} />}
          {token && (
            <LinkRotation
              token={token}
              confirmed={confirmedView}
              onManagementRotated={(next) => {
                replaceLinkToken(next);
                setToken(next);
              }}
            />
          )}
          {view.actions.cancel && (
            <div className="manage-secondary">
              <Button variant="destructive" className="btn-start" onClick={() => setConfirming(true)}>
                Cancel my registration…
              </Button>
              <ConfirmDialog
                open={confirming}
                title="Cancel your registration?"
                confirmLabel={busy ? 'Cancelling…' : 'Yes, cancel my registration'}
                cancelLabel="Keep my registration"
                destructive
                busy={busy}
                onConfirm={cancel}
                onClose={() => setConfirming(false)}
              >
                <p>
                  {confirmedView
                    ? 'Your ticket will stop working immediately and your seat goes to the next person on the waiting list. This cannot be undone.'
                    : 'You will leave the waiting list. This cannot be undone.'}
                </p>
              </ConfirmDialog>
            </div>
          )}
          {error && <Alert>{error}</Alert>}
        </aside>
      </div>
    </CenterPage>
  );
}
