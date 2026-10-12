import { expect, test } from '@playwright/test';
import {
  HOUR,
  address,
  createEvent,
  mailFor,
  openSection,
  registerParticipant,
  signIn,
  stat,
  waitForMail,
} from './helpers.js';

// K-304b in the organizer interface: FR-EVT-5 (edit title and description), AC-105 (no email).
test('organizer edits the title and description; the public page shows them and nobody is emailed', async ({
  page,
  browser,
}) => {
  const participant = address('guest');
  await signIn(page, address('organizer'));
  const original = `Edit me ${Date.now()}`;
  const { publicUrl } = await createEvent(page, { title: original, capacity: 2, startsInMs: 72 * HOUR });
  expect((await registerParticipant(browser, publicUrl, participant)).result).toBe('confirmed');
  await waitForMail(participant, 'Your ticket'); // registration emails are sent asynchronously
  const mailsBefore = mailFor(participant, '').length;

  const renamed = `${original} (room 4)`;
  await openSection(page, 'Settings');
  await page.getByLabel('Event title').fill(renamed);
  await page.getByLabel('Event description').fill('New room: 4.\nBring your laptop.');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(
    page.getByText('Details saved. Participants are not emailed about this change.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: renamed })).toBeVisible();

  // Persisted, and nothing else changed.
  await page.reload();
  await expect(page.getByRole('heading', { name: renamed })).toBeVisible();
  await expect(stat(page, 'Confirmed')).toHaveText('1');
  await expect(stat(page, 'Event capacity')).toHaveText('2');

  // The public registration page shows the new details.
  const visitor = await browser.newContext();
  const publicPage = await visitor.newPage();
  await publicPage.goto(publicUrl);
  await expect(publicPage.getByRole('heading', { name: renamed })).toBeVisible();
  await expect(publicPage.getByText('Bring your laptop.')).toBeVisible();
  await visitor.close();

  // No email about the edit: give the worker (500 ms polling) time to send anything queued.
  await page.waitForTimeout(3_000);
  expect(mailFor(participant, '')).toHaveLength(mailsBefore);
});
