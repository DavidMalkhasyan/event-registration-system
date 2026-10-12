import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CircleCheck, Keyboard, ScanLine, ShieldCheck, WifiOff } from 'lucide-react';
import { ApiError, api, errorMessage } from '../shared/api';
import { Button, formatLocal } from '../shared/ui';
import { useLiveCount } from './use-live-count';

// Entrance check-in (FR-CHK), shared by the owner's Check-in tab and the staff entry (PD-69). The
// caller decides who calls it; this module only uses the check-in, count and live endpoints, which
// both principals may use. Success is shown only for a server answer (FR-CHK-6).

const OUTCOME: Record<string, { title: string; text: string; ok: boolean }> = {
  CHECKED_IN: { title: 'Checked in', text: 'All set. Welcome them in.', ok: true },
  ALREADY_CHECKED_IN: {
    title: 'Already checked in',
    text: 'This ticket was already used. No second check-in was recorded.',
    ok: false,
  },
  INVALID_CODE: { title: 'Unknown ticket code', text: 'Check the code and try again.', ok: false },
  WRONG_EVENT: {
    title: 'Ticket for another event',
    text: 'This ticket belongs to a different event.',
    ok: false,
  },
  TICKET_CANCELLED: {
    title: 'Ticket cancelled',
    text: 'This registration was cancelled; the ticket is not valid.',
    ok: false,
  },
  EVENT_CANCELLED: { title: 'Event cancelled', text: 'Check-in is closed for a cancelled event.', ok: false },
  OUTSIDE_CHECK_IN_WINDOW: {
    title: 'Outside the check-in window',
    text: 'Tickets can be checked in only during the check-in window shown above.',
    ok: false,
  },
};

type Result =
  | { kind: 'outcome'; outcome: string; firstCheckedInAt?: string }
  | { kind: 'error'; message: string }
  | { kind: 'offline' };

declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => {
      detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
    };
  }
}

export interface CheckInEvent {
  title: string;
  timeZone: string;
  startsAt?: string;
  opensAt: string;
  closesAt: string;
  status?: ReactNode;
}

export function CheckInPanel({
  csrfToken,
  eventId,
  event,
  mode,
  aside,
}: {
  csrfToken: string;
  eventId: string;
  event: CheckInEvent;
  mode: 'owner' | 'staff';
  /** Owner only: recent arrivals with undo. Staff screens never get one. */
  aside?: ReactNode;
}) {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<Result>();
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Ready for the next code at the door, without scrolling the page to the field (K-706).
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);
  const live = useLiveCount(eventId);
  const canScan = typeof window !== 'undefined' && !!window.BarcodeDetector && !!navigator.mediaDevices;

  const submit = useCallback(
    async (value: string) => {
      if (!value.trim()) return;
      setBusy(true);
      const requestId = crypto.randomUUID();
      // Retry with the same request ID after a network failure; never assume success (FR-CHK-3, FR-CHK-6).
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const r = await api<{ outcome: string; firstCheckedInAt?: string }>(
            `/api/events/${eventId}/check-ins`,
            {
              method: 'POST',
              csrf: csrfToken,
              body: { code: value.trim(), requestId },
            },
          );
          setResult({ kind: 'outcome', ...r });
          setCode('');
          setBusy(false);
          inputRef.current?.focus({ preventScroll: true });
          return;
        } catch (err) {
          if (!(err instanceof ApiError) || err.code !== 'network_error') {
            setResult({ kind: 'error', message: errorMessage(err) });
            setBusy(false);
            return;
          }
        }
      }
      setResult({ kind: 'offline' });
      setBusy(false);
    },
    [eventId, csrfToken],
  );

  // Camera scanning where the browser provides BarcodeDetector; the image never leaves the device.
  useEffect(() => {
    if (!scanning || !window.BarcodeDetector) return;
    let stop = false;
    let stream: MediaStream | undefined;
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (s) => {
        stream = s;
        if (stop) return s.getTracks().forEach((t) => t.stop());
        const video = videoRef.current!;
        video.srcObject = s;
        await video.play();
        // A code is submitted once while it stays in view; when it leaves the frame and is shown
        // again, it is checked again (so a second use is still reported by the server).
        let inView: string | null = null;
        while (!stop) {
          const codes = await detector.detect(video).catch(() => []);
          const value = codes[0]?.rawValue ?? null;
          if (value && value !== inView && !stop) await submit(value);
          inView = value;
          await new Promise((r) => setTimeout(r, 300));
        }
      })
      .catch(() => {
        setCameraError('The camera could not be opened. You can still type the ticket code.');
        setScanning(false);
      });
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [scanning, submit]);

  const outcome = result?.kind === 'outcome' ? OUTCOME[result.outcome] : undefined;
  // The staff screen has no other page heading; in the organizer workspace the event title is the h1.
  const Heading = mode === 'staff' ? 'h1' : 'h2';
  return (
    <>
      <section className="check-in-event" aria-label="Event">
        <div>
          {event.status}
          <Heading className="check-in-title">
            <span className="sr-only">Check-in: </span>
            {event.title}
          </Heading>
          <p>
            Check-in window: {formatLocal(event.opensAt, event.timeZone)} to{' '}
            {formatLocal(event.closesAt, event.timeZone)}.
          </p>
        </div>
        <div className="check-in-total stat" aria-live="polite">
          <strong>{live.count ?? '–'}</strong>
          <small>
            {live.connected && <span className="live-dot" aria-hidden="true" />}
            checked in
          </small>
        </div>
      </section>

      <div className="scanner-grid">
        <section className="panel" aria-label="Ticket scanner">
          <div className="scanner-visual">
            {scanning ? (
              <video ref={videoRef} className="scanner-video" muted playsInline aria-label="Camera preview" />
            ) : (
              <>
                <ScanLine size={58} strokeWidth={1.2} aria-hidden="true" />
                <h2>A warm welcome starts here.</h2>
                <p>
                  {canScan
                    ? 'Scan the QR code on a ticket, or type its code below.'
                    : 'Type the 12-character code printed under the QR code.'}
                </p>
              </>
            )}
            {canScan && (
              <Button
                variant={scanning ? 'outline' : 'primary'}
                onClick={() => {
                  setCameraError(undefined);
                  setScanning(!scanning);
                }}
              >
                <ScanLine aria-hidden="true" />
                {scanning ? 'Stop camera' : 'Scan QR code with camera'}
              </Button>
            )}
            {cameraError && <p role="alert">{cameraError}</p>}
          </div>
          <div className="manual-entry">
            <label htmlFor="ticket-code" className="field-label manual-label">
              <Keyboard size={15} aria-hidden="true" />
              {canScan ? 'Or type the ticket code' : 'Ticket code'}
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit(code);
              }}
            >
              <input
                id="ticket-code"
                ref={inputRef}
                className="input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Ticket code, e.g. 7K3QX9M2B4TW"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                enterKeyHint="go"
              />
              <Button type="submit" size="lg" disabled={busy || !code.trim()}>
                {busy ? 'Checking…' : 'Check in'}
              </Button>
            </form>
            <p className="field-hint">
              Codes are not case-sensitive. Every code is checked by the server; no ticket list is stored on
              this device.
            </p>
          </div>
          {result && (
            <div
              role="status"
              aria-label="Check-in result"
              className={`scan-result ${
                result.kind === 'offline' ? 'unreachable' : outcome?.ok ? 'success' : 'failure'
              }`}
            >
              {result.kind === 'offline' ? (
                <WifiOff aria-hidden="true" />
              ) : outcome?.ok ? (
                <CircleCheck aria-hidden="true" />
              ) : (
                <AlertCircle aria-hidden="true" />
              )}
              <div>
                {result.kind === 'offline' ? (
                  <>
                    <h2>Cannot validate</h2>
                    <p>The server is unreachable. Do not admit yet; try again in a moment.</p>
                  </>
                ) : result.kind === 'error' ? (
                  <>
                    <h2>Not checked in</h2>
                    <p>{result.message}</p>
                  </>
                ) : (
                  <>
                    <h2>{outcome?.title ?? result.outcome}</h2>
                    <p>{outcome?.text}</p>
                    {result.firstCheckedInAt && (
                      <p>First check-in at {new Date(result.firstCheckedInAt).toLocaleTimeString()}</p>
                    )}
                  </>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setResult(undefined)}>
                Dismiss
              </Button>
            </div>
          )}
        </section>
        {aside}
      </div>
      <p className="check-in-note">
        <ShieldCheck size={15} aria-hidden="true" />
        {mode === 'staff'
          ? 'Staff mode · Ticket validation only · No participant email access'
          : 'Organizer mode · You can undo a check-in from the list of arrivals'}
      </p>
    </>
  );
}
