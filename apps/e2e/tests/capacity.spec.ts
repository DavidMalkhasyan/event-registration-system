import { expect, test } from '@playwright/test';
import { HOUR, address, createEvent, registerParticipant, signIn, stat, waitForMail } from './helpers.js';

// K-304a in the organizer interface: FR-EVT-7 (increase promotes FIFO), FR-EVT-8 (minimum).
test('organizer raises capacity to promote the waiting list, and cannot go below the confirmed count', async ({
  page,
  browser,
}) => {
  const first = address('first');
  const second = address('second');
  const third = address('third');
  await signIn(page, address('organizer'));
  const { publicUrl } = await createEvent(page, {
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
  await page.getByLabel('Number of seats').fill('2');
  await page.getByRole('button', { name: 'Update capacity' }).click();
  await expect(page.getByText('Capacity is now 2.')).toBeVisible();
  await expect(stat(page, 'Confirmed')).toHaveText('2');
  await expect(stat(page, 'Waiting list')).toHaveText('1');
  const [promotion] = await waitForMail(second, 'A place became free');
  expect(promotion!.text).toMatch(/Ticket code: [0-9A-HJKMNP-TV-Z]{12}/);

  // Below the confirmed count: rejected, and the minimum is shown.
  await page.getByLabel('Number of seats').fill('1');
  await page.getByRole('button', { name: 'Update capacity' }).click();
  await expect(page.getByText('The minimum allowed capacity is 2.')).toBeVisible();
  await page.reload();
  await expect(page.getByText(/capacity 2/)).toBeVisible();
  await expect(stat(page, 'Confirmed')).toHaveText('2');
});
