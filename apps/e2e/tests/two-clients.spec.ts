import { expect, test } from '@playwright/test';
import {
  HOUR,
  address,
  checkInResult,
  createEvent,
  localIn,
  openSection,
  openVerification,
  readResult,
  registerParticipant,
  signIn,
  stat,
  waitForMail,
} from './helpers.js';

// Two simultaneous browser clients (P0 general requirement), each with its own session.

test('dashboard on one device shows check-ins made on another device without refreshing', async ({
  browser,
}) => {
  const organizer = address('organizer');
  const guest = address('guest');
  const dashboardContext = await browser.newContext();
  const scannerContext = await browser.newContext();
  const dashboard = await dashboardContext.newPage();
  const scanner = await scannerContext.newPage();

  await signIn(dashboard, organizer);
  const title = `Meetup ${Date.now()}`;
  const { eventId, publicUrl } = await createEvent(dashboard, { title, capacity: 2, startsInMs: 72 * HOUR });
  const { ticketCode } = await registerParticipant(browser, publicUrl, guest);
  expect(ticketCode).toBeTruthy();

  // Reschedule into the check-in window (opens 2 hours before the start); the guest is told (P0 #14).
  await openSection(dashboard, 'Settings');
  await dashboard.getByLabel(/New date and time/).fill(localIn(1 * HOUR));
  await dashboard.getByRole('button', { name: 'Reschedule and notify' }).click();
  await expect(dashboard.getByText('Rescheduled. Every confirmed and waiting participant')).toBeVisible();
  await waitForMail(guest, 'Date changed');

  // Second device: the same organizer signs in separately and opens the entrance screen.
  await signIn(scanner, organizer);
  await scanner.goto(`/organizer/events/${eventId}/check-in`);
  await expect(scanner.getByRole('heading', { name: `Check-in: ${title}` })).toBeVisible();

  await expect(dashboard.getByText('Checked in (live)')).toBeVisible();
  await expect(stat(dashboard, 'Checked in')).toHaveText('0');
  await dashboard.evaluate(() => ((window as unknown as { marker: string }).marker = 'no reload'));

  await scanner.getByLabel('Ticket code').fill(ticketCode!.toLowerCase());
  await scanner.getByRole('button', { name: 'Check in' }).click();
  await expect(checkInResult(scanner)).toHaveText('Checked in');

  // The other device's dashboard updates live (P0 #12), with no page reload.
  await expect(stat(dashboard, 'Checked in')).toHaveText('1');
  expect(await dashboard.evaluate(() => (window as unknown as { marker?: string }).marker)).toBe('no reload');
  await expect(stat(scanner, 'Checked in')).toHaveText('1');

  // The same ticket cannot be used twice (P0 #10); unknown codes are rejected (P0 #9).
  await scanner.getByLabel('Ticket code').fill(ticketCode!);
  await scanner.getByRole('button', { name: 'Check in' }).click();
  await expect(checkInResult(scanner)).toHaveText('Already checked in');
  await expect(scanner.getByText(/First check-in at/)).toBeVisible();
  await scanner.getByLabel('Ticket code').fill('ZZZZZZZZZZZZ');
  await scanner.getByRole('button', { name: 'Check in' }).click();
  await expect(checkInResult(scanner)).toHaveText('Unknown ticket code');
  await expect(stat(dashboard, 'Checked in')).toHaveText('1');

  await dashboardContext.close();
  await scannerContext.close();
});

test('two participants confirming the last seat at the same moment: one ticket, one waiting-list place', async ({
  browser,
}) => {
  const organizerContext = await browser.newContext();
  const organizerPage = await organizerContext.newPage();
  await signIn(organizerPage, address('organizer'));
  const { publicUrl } = await createEvent(organizerPage, {
    title: `Last seat ${Date.now()}`,
    capacity: 1,
    startsInMs: 72 * HOUR,
  });

  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const emails = [address('first'), address('second')];
  for (const [i, page] of pages.entries()) await openVerification(page, publicUrl, emails[i]!);

  // Both browsers press "Confirm" at the same time (P0 #15).
  await Promise.all(pages.map((p) => p.getByRole('button', { name: 'Confirm my registration' }).click()));
  const results = await Promise.all(pages.map(readResult));
  expect(results.map((r) => r.result).sort()).toEqual(['confirmed', 'waitlisted']);

  await organizerPage.reload();
  await expect(stat(organizerPage, 'Confirmed')).toHaveText('1');
  await expect(stat(organizerPage, 'Waiting list')).toHaveText('1');
  for (const context of [...contexts, organizerContext]) await context.close();
});
