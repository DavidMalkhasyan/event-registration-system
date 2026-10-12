import { expect, test } from './fixtures.js';
import { ageOrganizerSessions } from './db.js';
import { HOUR, address, createEvent, linkIn, openSection, signIn, stat, waitForMail } from './helpers.js';

// K-302b in the browser (FR-ORG-5, AC-149), with the contextual flow of K-702: Settings no longer shows
// a sign-in status; a protected action asks the organizer to confirm it's them only when the server
// requires it, and never runs by itself afterwards. A stale session is prepared in the TEST database
// (controlled setup; the application has no backdoor), since real time can't pass 15 minutes here.
test('a stale session re-authenticates by email only when a protected action needs it; nothing else happens', async ({
  page,
  browser,
}) => {
  const organizer = address('organizer');
  await signIn(page, organizer);
  const title = `Protected ${Date.now()}`;
  await createEvent(page, { title, capacity: 2, startsInMs: 72 * HOUR });
  await openSection(page, 'Settings');
  const eventUrl = page.url();
  // No standing sign-in block in Settings (K-702).
  await expect(page.getByRole('heading', { name: 'Recent sign-in' })).toHaveCount(0);
  await expect(page.getByText('Careful changes')).toHaveCount(0);
  await expect(page.getByText('Your sign-in counts as recent until')).toHaveCount(0);

  // The session is now 16 minutes old (AC-149).
  expect(await ageOrganizerSessions(organizer, 16)).toBe(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Confirm it’s you' })).toHaveCount(0); // not until needed

  // A second browser holding the same (old) session, to show it is revoked afterwards.
  const oldDevice = await browser.newContext();
  await oldDevice.addCookies(await page.context().cookies());
  expect((await oldDevice.request.get('/api/auth/session')).status()).toBe(200);

  // The protected action itself asks for the confirmation; the server refused it.
  const cancelCard = page.getByRole('region', { name: 'Cancel event' });
  await cancelCard.getByRole('button', { name: 'Cancel event' }).click();
  await cancelCard.getByRole('button', { name: 'Yes, cancel the event permanently' }).click();
  await expect(cancelCard.getByText('the event is not cancelled until you confirm')).toBeVisible();
  await cancelCard.getByRole('button', { name: 'Confirm it’s you' }).click();
  await expect(page.getByText('We emailed a confirmation link to')).toBeVisible();
  const [mail] = await waitForMail(organizer, 'Confirm it is you');
  expect(mail!.text).toContain('does not cancel, delete or otherwise change any event');

  // Opening the link explains that it changes nothing; confirming returns to the event page.
  await page.goto(linkIn(mail!, 'sign-in'));
  await expect(page.getByRole('heading', { name: 'Confirm it’s you' })).toBeVisible();
  await expect(page.getByText('It does not cancel, delete or change any event.')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm it is you' }).click();
  await expect(page).toHaveURL(eventUrl);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  // Nothing ran by itself: still scheduled, and the cancellation needs a new, explicit confirmation.
  await expect(page.getByText('Status: CANCELLED.')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(cancelCard.getByRole('button', { name: 'Cancel event' })).toBeVisible();
  await expect(stat(page, 'Confirmed')).toHaveText('0');
  await expect(stat(page, 'Event capacity')).toHaveText('2');

  // The requesting session is revoked; the new one works.
  expect((await oldDevice.request.get('/api/auth/session')).status()).toBe(401);
  expect((await page.request.get('/api/auth/session')).status()).toBe(200);
  await oldDevice.close();
});
