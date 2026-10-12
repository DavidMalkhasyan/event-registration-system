import { expect, test } from './fixtures.js';
import { ORIGIN } from './env.js';
import {
  HOUR,
  address,
  createEvent,
  openSection,
  registerParticipant,
  signIn,
  stat,
  waitForMail,
} from './helpers.js';

// K-304a in the organizer interface (FR-EVT-7: an increase promotes FIFO), with amendment A-2 (K-707):
// capacity can only be increased, from 1 to 100 000; the forms correct values when the field is left.

test('organizer raises capacity to promote the waiting list, and cannot lower it in the form or the API', async ({
  page,
  browser,
}) => {
  const first = address('first');
  const second = address('second');
  const third = address('third');
  await signIn(page, address('organizer'));
  const { eventId, publicUrl } = await createEvent(page, {
    title: `Capacity ${Date.now()}`,
    capacity: 1,
    startsInMs: 72 * HOUR,
  });
  expect((await registerParticipant(browser, publicUrl, first)).result).toBe('confirmed');
  expect((await registerParticipant(browser, publicUrl, second)).result).toBe('waitlisted');
  expect((await registerParticipant(browser, publicUrl, third)).result).toBe('waitlisted');

  await page.reload();
  await expect(stat(page, 'Confirmed')).toHaveText('1');
  await expect(stat(page, 'Waiting list')).toHaveText('2');

  // Increase by one: the first person in line is promoted at once and emailed a ticket.
  await openSection(page, 'Settings');
  const seats = page.getByLabel('Number of seats');
  await expect(seats).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Update capacity' })).toBeDisabled(); // unchanged
  await seats.fill('2');
  await page.getByRole('button', { name: 'Update capacity' }).click();
  await expect(page.getByText('Capacity is now 2.')).toBeVisible();
  await expect(stat(page, 'Confirmed')).toHaveText('2');
  await expect(stat(page, 'Waiting list')).toHaveText('1');
  const [promotion] = await waitForMail(second, 'A place became free');
  expect(promotion!.text).toMatch(/Ticket code: [0-9A-HJKMNP-TV-Z]{12}/);

  // A lower value is set back to the current capacity when the field is left; nothing is sent.
  await seats.fill('1');
  await expect(seats).toHaveValue('1'); // typing is not interrupted
  await seats.blur();
  await expect(seats).toHaveValue('2');
  await expect(
    page.getByText(
      'Capacity can only be increased. The current capacity is 2 seats, so the value was set back to 2.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update capacity' })).toBeDisabled();
  // Above the maximum: set to 100 000. A fraction: refused, not rounded.
  await seats.fill('250000');
  await seats.blur();
  await expect(seats).toHaveValue('100000');
  await seats.fill('2.5');
  await seats.blur();
  await expect(seats).toHaveValue('2.5');
  await expect(page.getByText('Enter a whole number of seats, without decimals.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update capacity' })).toBeDisabled();

  // The API refuses a decrease too, whatever the form does.
  const { csrfToken } = (await (await page.request.get('/api/auth/session')).json()) as { csrfToken: string };
  const decrease = await page.request.put(`/api/events/${eventId}/capacity`, {
    headers: { origin: ORIGIN, 'x-csrf-token': csrfToken },
    data: { capacity: 1 },
  });
  expect(decrease.status()).toBe(409);
  expect(await decrease.json()).toMatchObject({ code: 'capacity_decrease_not_allowed', currentCapacity: 2 });
  await page.reload();
  await expect(stat(page, 'Event capacity')).toHaveText('2');
  await expect(stat(page, 'Confirmed')).toHaveText('2');
});

test('the creation form corrects capacity when the field is left and refuses fractions', async ({ page }) => {
  await signIn(page, address('organizer'));
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Create event' })
    .click();
  const capacity = page.getByLabel(/^Capacity/);
  await expect(page.getByText('Capacity (1 to 100,000 seats)')).toBeVisible();

  await capacity.fill('');
  await expect(capacity).toHaveValue(''); // blank is fine while editing
  await capacity.fill('250000');
  await capacity.blur();
  await expect(capacity).toHaveValue('100000');
  await expect(
    page.getByText('The maximum is 100,000 seats, so the value was set to 100,000.'),
  ).toBeVisible();
  await capacity.fill('0');
  await capacity.blur();
  await expect(capacity).toHaveValue('1');
  await capacity.fill('-4');
  await capacity.blur();
  await expect(capacity).toHaveValue('1');

  // A fraction blocks creation with an explanation.
  await page.getByLabel('Event title').fill(`Fraction ${Date.now()}`);
  await page.getByLabel('Date', { exact: true }).fill('2031-05-20');
  await page.getByLabel('Start time').fill('18:00');
  await capacity.fill('3.5');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page.getByText('Enter a whole number of seats, without decimals.')).toBeVisible();
  await expect(page).toHaveURL(/\/organizer\/events\/new$/);
});
