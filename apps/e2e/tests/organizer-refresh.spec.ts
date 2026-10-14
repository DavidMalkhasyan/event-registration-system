import { expect, test, type Page } from './fixtures.js';
import {
  HOUR,
  address,
  createEvent,
  linkIn,
  openSection,
  registerParticipant,
  signIn,
  stat,
  waitForMail,
} from './helpers.js';

// K-704 in the browser (PD-84): organizer views refresh in place, by the Refresh button and every 15 s
// while visible, without a page load, keeping tabs, search, filters, view and unsaved form values.
// Playwright's clock advances the organizer page's timers; everything else is the real application.

const TICK = 16_000;

/** Counts full page loads of `page` from now on. */
function countLoads(page: Page) {
  const state = { loads: 0 };
  page.on('load', () => (state.loads += 1));
  return state;
}

test('participants and waiting list update in place; search, filter and unsaved settings survive', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  await signIn(page, address('organizer'));
  const { eventId, publicUrl } = await createEvent(page, {
    title: `Refresh ${Date.now()}`,
    capacity: 1,
    startsInMs: 72 * HOUR,
  });
  const first = address('first');
  expect((await registerParticipant(browser, publicUrl, first)).result).toBe('confirmed');

  await page.clock.install();
  await page.goto(`/organizer/events/${eventId}/participants`);
  await expect(page.getByRole('row', { name: new RegExp(first) })).toBeVisible();
  const loads = countLoads(page);

  // Search and filter, then someone joins the waiting list elsewhere.
  await page.getByLabel('Search participants').fill('example.test');
  await page.getByLabel('Registration status').selectOption('WAITLISTED');
  const second = address('second');
  expect((await registerParticipant(browser, publicUrl, second)).result).toBe('waitlisted');
  await page.clock.fastForward(TICK);
  await expect(page.getByRole('row', { name: new RegExp(second) })).toBeVisible();
  await expect(page.getByLabel('Search participants')).toHaveValue('example.test');
  await expect(page.getByLabel('Registration status')).toHaveValue('WAITLISTED');
  await expect(stat(page, 'Waiting list')).toHaveText('1');

  // The waiting list section follows the next registration too.
  await openSection(page, 'Waiting list');
  const third = address('third');
  expect((await registerParticipant(browser, publicUrl, third)).result).toBe('waitlisted');
  await page.clock.fastForward(TICK);
  await expect(page.getByRole('row', { name: new RegExp(third) })).toContainText('Position #2');
  await expect(page.getByRole('navigation', { name: 'Event sections' })).toContainText('Waiting list2');

  // The Refresh button loads at once, without waiting for the timer.
  const fourth = address('fourth');
  expect((await registerParticipant(browser, publicUrl, fourth)).result).toBe('waitlisted');
  await page.getByRole('button', { name: 'Refresh event data' }).click();
  await expect(page.getByRole('row', { name: new RegExp(fourth) })).toBeVisible();
  await expect(page.getByText(/^Updated \d/)).toBeVisible();

  // An unsaved settings edit is never overwritten by background refreshes.
  await openSection(page, 'Settings');
  await page.getByLabel('Event title').fill('My unsaved title');
  await page.clock.fastForward(TICK);
  await page.clock.fastForward(TICK);
  await expect(page.getByLabel('Event title')).toHaveValue('My unsaved title');
  await expect(page.getByRole('button', { name: 'Save details' })).toBeEnabled();

  expect(loads.loads).toBe(0); // all of this without a single page load
});

test('staff invitations and device sessions update in place', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signIn(page, address('organizer'));
  const title = `Staff refresh ${Date.now()}`;
  const { eventId } = await createEvent(page, { title, capacity: 3, startsInMs: 72 * HOUR });
  await page.clock.install();
  await page.goto(`/organizer/events/${eventId}/staff`);
  const loads = countLoads(page);

  const helper = address('helper');
  await page.getByLabel('Staff email address').fill(helper);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`Invitation sent to ${helper}.`)).toBeVisible();
  await expect(page.getByText('Invited', { exact: true })).toBeVisible();
  await expect(page.getByText('No devices yet')).toBeVisible();

  // The helper accepts on their own device; the organizer's page shows it at the next refresh.
  const [invitation] = await waitForMail(helper, 'You are invited to help with check-in');
  const device = await browser.newContext();
  const staff = await device.newPage();
  await staff.goto(linkIn(invitation!, 'invite'));
  await staff.getByRole('button', { name: 'Accept' }).click();
  await expect(staff).toHaveURL(/\/staff$/);
  await page.clock.fastForward(TICK);
  await expect(page.getByText('Accepted', { exact: true })).toBeVisible();
  await expect(page.getByText('Check-in device')).toBeVisible();

  // Revoking updates the list at once; the device loses access.
  await page.getByRole('button', { name: 'Revoke access' }).click();
  await expect(page.getByText('Staff access revoked.')).toBeVisible();
  await expect(page.getByText('No devices yet')).toBeVisible();
  expect((await staff.request.get('/api/staff/session')).status()).toBe(401);
  await device.close();
  expect(loads.loads).toBe(0);
});

test('the overview and All events refresh in place, keeping the search and the list view', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signIn(page, address('organizer'));
  const title = `Gallery refresh ${Date.now()}`;
  const { publicUrl } = await createEvent(page, { title, capacity: 5, startsInMs: 72 * HOUR });
  await page.clock.install();
  await page.goto('/organizer/events');
  const loads = countLoads(page);

  await page.getByLabel('Search events').fill(title);
  await page.getByRole('button', { name: 'List view' }).click();
  const row = page.getByRole('row', { name: new RegExp(title) });
  await expect(row).toContainText('0 / 5');

  expect((await registerParticipant(browser, publicUrl, address('guest'))).result).toBe('confirmed');
  await page.clock.fastForward(TICK);
  await expect(row).toContainText('1 / 5');
  await expect(page.getByLabel('Search events')).toHaveValue(title);
  await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');

  // The overview's totals, with its own Refresh button.
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Overview' })
    .click();
  const confirmed = page
    .getByRole('region', { name: 'Across all your events' })
    .locator('div', { hasText: 'Confirmed participants' })
    .locator('strong');
  await expect(confirmed).toContainText('1');
  expect((await registerParticipant(browser, publicUrl, address('guest2'))).result).toBe('confirmed');
  await page.getByRole('button', { name: 'Refresh overview' }).click();
  await expect(confirmed).toContainText('2');
  expect(loads.loads).toBe(0);
});
