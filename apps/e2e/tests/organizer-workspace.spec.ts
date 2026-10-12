import { expect, test, type Page } from '@playwright/test';
import { HOUR, address, createEvent, registerParticipant, signIn, stat, watchCsp } from './helpers.js';

// K-507: one organizer manages several events. The overview sums all of them (PD-67); each event's
// workspace shows only its own figures; the sidebar and the All events page move between events.

function overviewTotal(page: Page, label: string) {
  return page
    .getByRole('region', { name: 'Across all your events' })
    .locator('div', { hasText: label })
    .locator('strong');
}

test('several events: overview totals versus each event’s own figures, and navigation between events', async ({
  page,
  browser,
}) => {
  const violations = await watchCsp(page.context());
  await signIn(page, address('organizer'));
  const stamp = Date.now();
  const first = `Morning talk ${stamp}`;
  const second = `Evening social ${stamp}`;
  const one = await createEvent(page, { title: first, capacity: 2, startsInMs: 72 * HOUR });
  const two = await createEvent(page, { title: second, capacity: 5, startsInMs: 96 * HOUR });
  for (const who of ['a', 'b', 'c']) await registerParticipant(browser, one.publicUrl, address(who));
  await registerParticipant(browser, two.publicUrl, address('d'));

  // The global dashboard sums both events.
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Overview' })
    .click();
  await expect(overviewTotal(page, 'Total events')).toContainText('2');
  await expect(overviewTotal(page, 'Confirmed participants')).toContainText('3');
  await expect(page.getByText('1 more on waiting lists')).toBeVisible();

  // Each event page shows its own figures only; the sidebar switches between events.
  const upcoming = page.getByRole('navigation', { name: 'Upcoming events' });
  await upcoming.getByRole('link', { name: first }).click();
  await expect(page).toHaveURL(new RegExp(`/organizer/events/${one.eventId}$`));
  await expect(page.getByRole('heading', { level: 1, name: first })).toBeVisible();
  await expect(stat(page, 'Confirmed')).toHaveText('2');
  await expect(stat(page, 'Waiting list')).toHaveText('1');
  await upcoming.getByRole('link', { name: second }).click();
  await expect(page).toHaveURL(new RegExp(`/organizer/events/${two.eventId}$`));
  await expect(page.getByRole('heading', { level: 1, name: second })).toBeVisible();
  await expect(stat(page, 'Confirmed')).toHaveText('1');
  await expect(stat(page, 'Waiting list')).toHaveText('0');

  // All events: search narrows the gallery; filters use real phases.
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'All events' })
    .click();
  const gallery = page.getByRole('main');
  await expect(gallery.getByRole('link', { name: new RegExp(`^${first}`) })).toBeVisible();
  await page.getByLabel('Search events').fill('Evening social');
  await expect(gallery.getByRole('link', { name: new RegExp(`^${first}`) })).toHaveCount(0);
  await expect(
    gallery.getByRole('link', { name: new RegExp(`^${second}, Registration open`) }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Cancelled/ }).click();
  await expect(page.getByText('No events match.')).toBeVisible();
  // The list view links into the same workspace.
  await page.getByRole('button', { name: /^Upcoming/ }).click();
  await page.getByRole('button', { name: 'List view' }).click();
  await gallery.getByRole('link', { name: second }).click();
  await expect(page).toHaveURL(new RegExp(`/organizer/events/${two.eventId}$`));
  expect(violations).toEqual([]); // the organizer area works under the strict policy
});

test('mobile: the navigation drawer opens, traps Escape, and navigates', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signIn(page, address('organizer'));
  const noOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(await noOverflow()).toBe(true);

  const menu = page.getByRole('button', { name: 'Open navigation' });
  await menu.click();
  const drawer = page.getByRole('dialog', { name: 'Workspace navigation' });
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused(); // focus returns to the trigger

  await menu.click();
  await drawer.getByRole('link', { name: 'Create event' }).click();
  await expect(page).toHaveURL(/\/organizer\/events\/new$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Something great starts here.' })).toBeVisible();
  expect(await noOverflow()).toBe(true);
  await context.close();
});
