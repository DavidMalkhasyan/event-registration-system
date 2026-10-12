import { expect, test } from './fixtures.js';
import { ageOrganizerSessions } from './db.js';
import { HOUR, address, createEvent, linkIn, openSection, signIn, stat, waitForMail } from './helpers.js';

// K-302b in the browser (FR-ORG-5, AC-149). A stale session is prepared in the TEST database
// (controlled setup; the application has no backdoor), since real time can't pass 15 minutes here.
test('a stale session re-authenticates by email and returns to the event; nothing else happens', async ({
  page,
  browser,
}) => {
  const organizer = address('organizer');
  await signIn(page, organizer);
  const title = `Protected ${Date.now()}`;
  await createEvent(page, { title, capacity: 2, startsInMs: 72 * HOUR });
  await openSection(page, 'Settings'); // the sign-in status sits next to the protected actions
  const eventUrl = page.url();
  await expect(page.getByText('Your sign-in counts as recent until')).toBeVisible();

  // The session is now 16 minutes old (AC-149).
  expect(await ageOrganizerSessions(organizer, 16)).toBe(1);
  await page.reload();
  await expect(page.getByText('Your last sign-in was more than 15 minutes ago.')).toBeVisible();

  // A second browser holding the same (old) session, to show it is revoked afterwards.
  const oldDevice = await browser.newContext();
  await oldDevice.addCookies(await page.context().cookies());
  expect((await oldDevice.request.get('/api/auth/session')).status()).toBe(200);

  await page.getByRole('button', { name: 'Confirm it’s you' }).click();
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
  await expect(page.getByText('Your sign-in counts as recent until')).toBeVisible();
  await expect(stat(page, 'Confirmed')).toHaveText('0'); // the event is untouched
  await expect(stat(page, 'Event capacity')).toHaveText('2');

  // The requesting session is revoked; the new one works.
  expect((await oldDevice.request.get('/api/auth/session')).status()).toBe(401);
  expect((await page.request.get('/api/auth/session')).status()).toBe(200);
  await oldDevice.close();
});
