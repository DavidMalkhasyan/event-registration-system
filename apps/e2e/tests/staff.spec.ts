import { expect, test } from '@playwright/test';
import {
  HOUR,
  address,
  createEvent,
  checkInResult,
  linkIn,
  localIn,
  openSection,
  registerParticipant,
  signIn,
  stat,
  waitForMail,
} from './helpers.js';

// K-406 in the browser: FR-STAFF-1 to FR-STAFF-4, PD-56, PD-57.
test('owner invites staff; staff accept on their device, check tickets in, and lose access when revoked', async ({
  page,
  browser,
}) => {
  await signIn(page, address('organizer'));
  const title = `Staffed ${Date.now()}`;
  const { eventId, publicUrl } = await createEvent(page, { title, capacity: 3, startsInMs: 72 * HOUR });
  const { ticketCode } = await registerParticipant(browser, publicUrl, address('guest'));
  // Into the check-in window (opens 2 hours before the start).
  await openSection(page, 'Settings');
  await page.getByLabel(/New date and time/).fill(localIn(1 * HOUR));
  await page.getByRole('button', { name: 'Reschedule and notify' }).click();
  await expect(page.getByText('Rescheduled.')).toBeVisible();

  const helper = address('helper');
  await openSection(page, 'Staff');
  await page.getByLabel('Staff email address').fill(helper);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`Invitation sent to ${helper}.`)).toBeVisible();
  const [invitation] = await waitForMail(helper, 'You are invited to help with check-in');
  const inviteUrl = linkIn(invitation!, 'invite');

  // The staff member's own device.
  const device = await browser.newContext();
  const staff = await device.newPage();
  await staff.goto(inviteUrl);
  await expect(staff.getByRole('heading', { name: 'Check-in invitation' })).toBeVisible();
  await staff.getByRole('button', { name: 'Accept' }).click();
  await expect(staff).toHaveURL(/\/staff$/);
  await expect(staff.getByRole('heading', { name: `Check-in: ${title}` })).toBeVisible();
  await staff.getByLabel('Ticket code').fill(ticketCode!);
  await staff.getByRole('button', { name: 'Check in' }).click();
  await expect(checkInResult(staff)).toHaveText('Checked in');
  await expect(stat(staff, 'Checked in')).toHaveText('1'); // live count for staff

  // Staff can't use organizer endpoints (PD-56), and the invitation link works only once.
  expect((await staff.request.get(`/api/events/${eventId}/participants`)).status()).toBe(403);
  const reuse = await (await browser.newContext()).newPage();
  await reuse.goto(inviteUrl);
  await expect(reuse.getByRole('heading', { name: 'Link not valid' })).toBeVisible();

  // The owner sees the accepted invitation and the device, and revokes it.
  await page.reload();
  await expect(page.getByText('Accepted', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Revoke access' }).click();
  await expect(page.getByText('Staff access revoked.')).toBeVisible();

  await staff.reload();
  await expect(staff.getByRole('heading', { name: 'No check-in access' })).toBeVisible();
  await device.close();
});
