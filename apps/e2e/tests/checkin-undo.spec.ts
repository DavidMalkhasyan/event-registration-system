import { expect, test } from '@playwright/test';
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
} from './helpers.js';

// K-306 in the browser: FR-CHK-8, AC-27, AC-54; staff can't undo (AC-26).
test('owner undoes a check-in after confirming; the share view shows the ticket again; it can be checked in again', async ({
  page,
  browser,
}) => {
  await signIn(page, address('organizer'));
  const title = `Undo ${Date.now()}`;
  const { eventId, publicUrl } = await createEvent(page, { title, capacity: 3, startsInMs: 72 * HOUR });
  const guest = address('guest');
  const { ticketCode } = await registerParticipant(browser, publicUrl, guest);
  const [ticketMail] = await waitForMail(guest, 'Your ticket');
  const shareUrl = linkIn(ticketMail!, 'ticket');
  // Into the check-in window (opens 2 hours before the start).
  await openSection(page, 'Settings');
  await page.getByLabel(/New date and time/).fill(localIn(1 * HOUR));
  await page.getByRole('button', { name: 'Reschedule and notify' }).click();
  await expect(page.getByText('Rescheduled.')).toBeVisible();

  const checkInOnce = async () => {
    await openSection(page, 'Check-in');
    await page.getByLabel('Ticket code').fill(ticketCode!);
    await page.getByRole('button', { name: 'Check in' }).click();
    await expect(checkInResult(page)).toHaveText('Checked in');
    await openSection(page, 'Participants');
    await expect(stat(page, 'Checked in')).toHaveText('1');
  };
  await checkInOnce();

  const share = await (await browser.newContext()).newPage();
  await share.goto(shareUrl);
  await expect(share.getByText('Already checked in.')).toBeVisible();
  await expect(share.locator('.ticket-code')).toHaveCount(0);

  // The owner asks to undo, changes their mind, then confirms with a reason.
  const row = page.getByRole('row', { name: new RegExp(guest) });
  await row.getByRole('button', { name: 'Undo check-in' }).click();
  await row.getByRole('button', { name: 'Keep check-in' }).click();
  await expect(stat(page, 'Checked in')).toHaveText('1');
  await row.getByRole('button', { name: 'Undo check-in' }).click();
  await row.getByLabel('Reason (optional)').fill('Scanned by mistake');
  await row.getByRole('button', { name: 'Confirm undo' }).click();
  await expect(
    page.getByText(`Check-in undone for ${guest}. The ticket can be checked in again.`),
  ).toBeVisible();
  await expect(stat(page, 'Checked in')).toHaveText('0');
  await expect(row.getByRole('button', { name: 'Undo check-in' })).toHaveCount(0);

  // Opened again from the email in a new tab: the link token lives in memory only, so a reload has none.
  const again = await share.context().newPage();
  await again.goto(shareUrl);
  await expect(again.locator('.ticket-code')).toHaveText(ticketCode!);
  await expect(again.getByRole('img', { name: `QR code for ticket ${ticketCode}` })).toBeVisible();

  await checkInOnce();

  // A staff device of this event has no undo control, and the server refuses it.
  const helper = address('helper');
  await openSection(page, 'Staff');
  await page.getByLabel('Staff email address').fill(helper);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  const [invitation] = await waitForMail(helper, 'You are invited to help with check-in');
  const device = await browser.newContext();
  const staff = await device.newPage();
  await staff.goto(linkIn(invitation!, 'invite'));
  await staff.getByRole('button', { name: 'Accept' }).click();
  await expect(staff.getByRole('heading', { name: `Check-in: ${title}` })).toBeVisible();
  await expect(staff.getByRole('button', { name: /Undo/ })).toHaveCount(0);
  const { csrfToken } = await (await staff.request.get('/api/staff/session')).json();
  const participants = await page.request.get(`/api/events/${eventId}/participants`);
  const checkInId = (await participants.json()).items[0].checkInId as string;
  const refused = await staff.request.post(`/api/events/${eventId}/check-ins/${checkInId}/undo`, {
    headers: { origin: new URL(staff.url()).origin, 'x-csrf-token': csrfToken },
    data: {},
  });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).code).toBe('forbidden');
  await device.close();
});
