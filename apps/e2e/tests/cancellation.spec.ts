import { expect, test, type Page } from './fixtures.js';
import { ageOrganizerSessions } from './db.js';
import {
  HOUR,
  address,
  createEvent,
  checkInResult,
  linkIn,
  openSection,
  registerParticipant,
  signIn,
  stat,
  waitForMail,
} from './helpers.js';

// K-304c in the browser: FR-EVT-9, BR-16, FR-ORG-5, AC-19, PD-41, PD-42.

const cancelCard = (page: Page) => page.getByRole('region', { name: 'Cancel event' });

async function cancelThroughUi(page: Page) {
  await cancelCard(page).getByRole('button', { name: 'Cancel this event…' }).click();
  await expect(page.getByText('This cannot be undone.')).toBeVisible();
  await cancelCard(page).getByRole('button', { name: 'Yes, cancel the event permanently' }).click();
}

test('fresh session: cancel with confirmation; organizer and public pages show CANCELLED; registration and check-in are blocked', async ({
  page,
  browser,
}) => {
  const organizer = address('organizer');
  const guest = address('guest');
  const waiting = address('waiting');
  await signIn(page, organizer);
  const title = `Cancel me ${Date.now()}`;
  const { eventId, publicUrl } = await createEvent(page, { title, capacity: 1, startsInMs: 72 * HOUR });
  const { ticketCode } = await registerParticipant(browser, publicUrl, guest);
  expect((await registerParticipant(browser, publicUrl, waiting)).result).toBe('waitlisted');
  await page.reload();
  await expect(stat(page, 'Confirmed')).toHaveText('1');
  await openSection(page, 'Settings');

  // "Keep the event" backs out without doing anything.
  await cancelCard(page).getByRole('button', { name: 'Cancel this event…' }).click();
  await cancelCard(page).getByRole('button', { name: 'Keep the event' }).click();
  await expect(page.getByText('Status: CANCELLED.')).toHaveCount(0);

  await cancelThroughUi(page);
  await expect(page.getByText('Status: CANCELLED.')).toBeVisible();
  await expect(stat(page, 'Confirmed')).toHaveText('0');
  await expect(stat(page, 'Waiting list')).toHaveText('0');
  await expect(cancelCard(page)).toHaveCount(0); // no cancellation action on a cancelled event
  await expect(page.getByRole('button', { name: 'Update capacity' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save details' })).toHaveCount(0);

  for (const email of [guest, waiting]) {
    const [mail] = await waitForMail(email, 'Event cancelled');
    expect(mail!.text).not.toMatch(/#t=/);
  }

  // Public page: clearly cancelled, no registration form; the API refuses new registrations.
  const visitor = await browser.newContext();
  const publicPage = await visitor.newPage();
  await publicPage.goto(publicUrl);
  await expect(publicPage.getByText('The organizer has cancelled this event.')).toBeVisible();
  await expect(publicPage.getByLabel('Email address')).toHaveCount(0);
  const publicId = publicUrl.split('/e/')[1]!;
  const attempt = await publicPage.request.post(`/api/public/events/${publicId}/registrations`, {
    data: { email: address('late') },
    headers: { origin: new URL(publicUrl).origin },
  });
  expect(attempt.status()).toBe(409);
  expect((await attempt.json()).code).toBe('registration_closed');
  await visitor.close();

  // Check-in: the ticket is refused (AC-19).
  await page.goto(`/organizer/events/${eventId}/check-in`);
  await page.getByLabel('Ticket code').fill(ticketCode!);
  await page.getByRole('button', { name: 'Check in' }).click();
  await expect(checkInResult(page)).toHaveText('Event cancelled');

  // The list of all events shows the status.
  await page.goto('/organizer/events');
  await expect(page.getByRole('link', { name: new RegExp(`${title}.*Cancelled`) })).toBeVisible();
});

test('stale session: re-authenticate by email, come back, and confirm the cancellation again', async ({
  page,
  browser,
}) => {
  const organizer = address('organizer');
  const guest = address('guest');
  await signIn(page, organizer);
  const { publicUrl } = await createEvent(page, {
    title: `Stale cancel ${Date.now()}`,
    capacity: 2,
    startsInMs: 72 * HOUR,
  });
  await registerParticipant(browser, publicUrl, guest);
  await openSection(page, 'Settings');
  const eventUrl = page.url();
  expect(await ageOrganizerSessions(organizer, 16)).toBe(1); // controlled test-database setup
  await page.reload();

  await cancelThroughUi(page);
  await expect(cancelCard(page).getByText('the event is not cancelled until you confirm')).toBeVisible();
  await expect(page.getByText('Status: CANCELLED.')).toHaveCount(0);
  await cancelCard(page).getByRole('button', { name: 'Confirm it’s you' }).click();
  const [mail] = await waitForMail(organizer, 'Confirm it is you');

  await page.goto(linkIn(mail!, 'sign-in'));
  await page.getByRole('button', { name: 'Confirm it is you' }).click();
  await expect(page).toHaveURL(eventUrl);
  // The link cancelled nothing: the event is still scheduled and asks for a new confirmation.
  await expect(page.getByText('Status: CANCELLED.')).toHaveCount(0);
  await expect(cancelCard(page).getByRole('button', { name: 'Cancel this event…' })).toBeVisible();

  await cancelThroughUi(page);
  await expect(page.getByText('Status: CANCELLED.')).toBeVisible();
  const mails = await waitForMail(guest, 'Event cancelled');
  expect(mails).toHaveLength(1);
});
