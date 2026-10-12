import { expect, test, type Page } from '@playwright/test';
import {
  HOUR,
  address,
  checkInResult,
  createEvent,
  linkIn,
  localIn,
  openSection,
  registerParticipant,
  signIn,
  stat,
  waitForMail,
  watchCsp,
} from './helpers.js';

// Camera QR check-in on a staff device (FR-CHK, FR-STAFF-2). No camera hardware or shape-detection
// support exists in CI, so the browser capabilities are controlled: getUserMedia returns a real
// MediaStream from a canvas (or is denied), and BarcodeDetector reports whatever code the test "holds
// up". Everything after detection is real: the staff session, the check-in endpoint and the database.

type ScanControl = { code: string | null; denied: boolean; streams: MediaStream[]; constraints?: unknown };

const hold = (page: Page, code: string | null) =>
  page.evaluate((c) => ((window as unknown as { __scan: ScanControl }).__scan.code = c), code);

test('staff camera scanning: denial falls back, a scan checks in, a re-presented ticket is a duplicate, stop releases the camera', async ({
  page,
  browser,
}) => {
  await signIn(page, address('organizer'));
  const title = `Camera ${Date.now()}`;
  const { eventId, publicUrl } = await createEvent(page, { title, capacity: 3, startsInMs: 72 * HOUR });
  const { ticketCode } = await registerParticipant(browser, publicUrl, address('guest'));
  await openSection(page, 'Settings');
  await page.getByLabel(/New date and time/).fill(localIn(1 * HOUR));
  await page.getByRole('button', { name: 'Reschedule and notify' }).click();
  await expect(page.getByText('Rescheduled.')).toBeVisible();
  await openSection(page, 'Staff');
  const helper = address('door');
  await page.getByLabel('Staff email address').fill(helper);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  const [invitation] = await waitForMail(helper, 'You are invited to help with check-in');

  const device = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const violations = await watchCsp(device);
  await device.addInitScript(() => {
    const control: ScanControl = { code: null, denied: false, streams: [] };
    (window as unknown as { __scan: ScanControl }).__scan = control;
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {
      async detect() {
        return control.code ? [{ rawValue: control.code }] : [];
      }
    };
    navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      control.constraints = constraints;
      if (control.denied) throw new DOMException('Permission denied', 'NotAllowedError');
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      canvas.getContext('2d')!.fillRect(0, 0, 320, 240);
      const stream = canvas.captureStream(5);
      control.streams.push(stream);
      return stream;
    };
  });
  const staff = await device.newPage();
  const requests: string[] = [];
  staff.on('request', (r) => requests.push(`${r.method()} ${new URL(r.url()).pathname}`));
  await staff.goto(linkIn(invitation!, 'invite'));
  await staff.getByRole('button', { name: 'Accept' }).click();
  await expect(staff.getByRole('heading', { name: `Check-in: ${title}` })).toBeVisible();
  const scanButton = staff.getByRole('button', { name: 'Scan QR code with camera' });

  // 1. Permission denied: a clear message, the camera is off, and manual entry stays available.
  await staff.evaluate(() => ((window as unknown as { __scan: ScanControl }).__scan.denied = true));
  await scanButton.click();
  await expect(
    staff.getByText('The camera could not be opened. You can still type the ticket code.'),
  ).toBeVisible();
  await expect(scanButton).toBeVisible();
  await expect(staff.getByLabel('Camera preview')).toHaveCount(0);
  await expect(staff.getByLabel('Ticket code')).toBeEditable();

  // 2. Permission granted: the rear camera is requested and previewed; a held-up ticket is checked in
  //    through the real endpoint, once, while it stays in view.
  await staff.evaluate(() => ((window as unknown as { __scan: ScanControl }).__scan.denied = false));
  await scanButton.click();
  await expect(staff.getByLabel('Camera preview')).toBeVisible();
  expect(
    await staff.evaluate(() => (window as unknown as { __scan: ScanControl }).__scan.constraints),
  ).toEqual({ video: { facingMode: 'environment' } });
  const checkIn = staff.waitForRequest(
    (r) => r.method() === 'POST' && new URL(r.url()).pathname === `/api/events/${eventId}/check-ins`,
  );
  await hold(staff, ticketCode!);
  expect((await checkIn).postDataJSON().code).toBe(ticketCode);
  await expect(checkInResult(staff)).toHaveText('Checked in');
  await expect(stat(staff, 'Checked in')).toHaveText('1');
  await staff.waitForTimeout(1500); // still in view: no second submission
  expect(requests.filter((r) => r === `POST /api/events/${eventId}/check-ins`)).toHaveLength(1);

  // 3. The same ticket taken away and shown again is reported as already used.
  await hold(staff, null);
  await staff.waitForTimeout(700);
  await hold(staff, ticketCode!);
  await expect(checkInResult(staff)).toHaveText('Already checked in');
  await expect(stat(staff, 'Checked in')).toHaveText('1');

  // 4. Stopping releases the camera: every track ends and the preview is gone.
  await hold(staff, null);
  await staff.getByRole('button', { name: 'Stop camera' }).click();
  await expect(staff.getByLabel('Camera preview')).toHaveCount(0);
  const states = await staff.evaluate(() =>
    (window as unknown as { __scan: ScanControl }).__scan.streams.flatMap((s) =>
      s.getTracks().map((t) => t.readyState),
    ),
  );
  expect(states.length).toBeGreaterThan(0);
  expect(states.every((s) => s === 'ended')).toBe(true);

  // The staff device only ever called its own session and the check-in, count and live endpoints.
  const api = requests.filter((r) => r.includes(' /api/'));
  for (const r of api)
    expect(r, r).toMatch(
      new RegExp(
        `^(GET /api/staff/session|POST /api/events/${eventId}/check-ins|GET /api/events/${eventId}/(live|check-in-count)|(GET|POST) /api/links/invite(/accept)?)$`,
      ),
    );
  await expect(staff.getByRole('button', { name: /Undo/ })).toHaveCount(0);
  expect(violations).toEqual([]);
  await device.close();
});
