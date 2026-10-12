import { expect, test, type Page } from '@playwright/test';
import { ageOrganizerSessions } from './db.js';
import {
  HOUR,
  address,
  createEvent,
  linkIn,
  mailFor,
  openSection,
  openVerification,
  registerParticipant,
  signIn,
  waitForMail,
} from './helpers.js';

// K-304d in the browser: FR-EVT-10, FR-EVT-11, FR-EVT-13, FR-ORG-5.

const deleteCard = (page: Page) => page.getByRole('region', { name: 'Delete event' });

test('deletes an eligible event; it disappears, and a pending registrant’s link stops working', async ({
  page,
  browser,
}) => {
  await signIn(page, address('organizer'));
  const title = `Delete me ${Date.now()}`;
  const { publicUrl } = await createEvent(page, { title, capacity: 2, startsInMs: 72 * HOUR });
  // A registration that was never confirmed does not block deletion.
  const pending = address('pending');
  const visitor = await browser.newContext();
  const visitorPage = await visitor.newPage();
  await openVerification(visitorPage, publicUrl, pending);
  await openSection(page, 'Settings');

  await deleteCard(page).getByRole('button', { name: 'Delete this event…' }).click();
  await expect(page.getByText(`Delete “${title}” permanently?`)).toBeVisible();
  await deleteCard(page).getByRole('button', { name: 'Yes, delete the event permanently' }).click();
  await expect(page).toHaveURL(/\/organizer\?deleted=1$/);
  await expect(page.getByText('The event was deleted.')).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(title) })).toHaveCount(0);

  await visitorPage.goto(publicUrl);
  await expect(visitorPage.getByText('Event not found.')).toBeVisible();
  await visitorPage.goto(linkIn(mailFor(pending, 'Confirm your registration')[0]!, 'verify'));
  await expect(visitorPage.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
  await visitor.close();
});

test('explains why an event can’t be deleted, and offers no deletion for a cancelled event', async ({
  page,
  browser,
}) => {
  await signIn(page, address('organizer'));
  const { publicUrl } = await createEvent(page, {
    title: `Busy ${Date.now()}`,
    capacity: 2,
    startsInMs: 72 * HOUR,
  });
  await registerParticipant(browser, publicUrl, address('guest'));
  await page.reload();
  await openSection(page, 'Settings');

  await deleteCard(page).getByRole('button', { name: 'Delete this event…' }).click();
  await expect(deleteCard(page).getByText('It still has confirmed participants.')).toBeVisible();
  await expect(
    deleteCard(page).getByRole('button', { name: 'Yes, delete the event permanently' }),
  ).toHaveCount(0);

  // After cancellation there is no delete action at all (FR-EVT-11).
  await page
    .getByRole('region', { name: 'Cancel event' })
    .getByRole('button', { name: 'Cancel this event…' })
    .click();
  await page.getByRole('button', { name: 'Yes, cancel the event permanently' }).click();
  await expect(page.getByText('Status: CANCELLED.')).toBeVisible();
  await expect(deleteCard(page)).toHaveCount(0);
});

test('a stale session confirms it’s you, comes back, and confirms the deletion again', async ({ page }) => {
  const organizer = address('organizer');
  await signIn(page, organizer);
  const title = `Stale delete ${Date.now()}`;
  await createEvent(page, { title, capacity: 2, startsInMs: 72 * HOUR });
  await openSection(page, 'Settings');
  const eventUrl = page.url();
  expect(await ageOrganizerSessions(organizer, 16)).toBe(1); // controlled test-database setup
  await page.reload();

  await deleteCard(page).getByRole('button', { name: 'Delete this event…' }).click();
  await expect(deleteCard(page).getByText('nothing is deleted until you confirm')).toBeVisible();
  await deleteCard(page).getByRole('button', { name: 'Confirm it’s you' }).click();
  const [mail] = await waitForMail(organizer, 'Confirm it is you');
  await page.goto(linkIn(mail!, 'sign-in'));
  await page.getByRole('button', { name: 'Confirm it is you' }).click();
  await expect(page).toHaveURL(eventUrl);
  await expect(page.getByRole('heading', { name: title })).toBeVisible(); // the link deleted nothing

  await deleteCard(page).getByRole('button', { name: 'Delete this event…' }).click();
  await deleteCard(page).getByRole('button', { name: 'Yes, delete the event permanently' }).click();
  await expect(page).toHaveURL(/\/organizer\?deleted=1$/);
});
