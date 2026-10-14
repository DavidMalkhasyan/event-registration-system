import { expect, test, type Page } from './fixtures.js';
import { HOUR, address, createEvent, registerParticipant, signIn } from './helpers.js';

// K-706 in the browser: moving between the sections of one event, refreshing and acting keep the page
// where it is (the section tabs stay at the same place on screen), never reload it, and keep search,
// filters and unsaved form values. Checked at desktop, tablet and phone widths on a scrolled page.

const OFFSET = 80; // where the tabs are placed before each check, in px from the top of the viewport

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Event sections' });
const tabsTop = (page: Page) =>
  page.evaluate(() => Math.round(document.querySelector('nav.tabs')!.getBoundingClientRect().top));
const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));

async function scrollTabsTo(page: Page, top: number) {
  await page.evaluate((t) => {
    const nav = document.querySelector('nav.tabs')!;
    window.scrollTo(0, window.scrollY + nav.getBoundingClientRect().top - t);
  }, top);
  await expect.poll(() => tabsTop(page)).toBe(top);
}

async function openTab(page: Page, name: string) {
  // A plain click on the link, as a user would; dispatching it avoids Playwright's own scrolling.
  await tabs(page)
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .dispatchEvent('click', { button: 0 });
  await expect(tabs(page).getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute(
    'aria-current',
    'page',
  );
}

test('section tabs, refresh and history keep the page in place at 1440, 768 and 390 px', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await signIn(page, address('organizer'));
  const { eventId, publicUrl } = await createEvent(page, {
    title: `Navigation ${Date.now()}`,
    capacity: 1,
    startsInMs: 72 * HOUR,
  });
  await registerParticipant(browser, publicUrl, address('first'));
  await registerParticipant(browser, publicUrl, address('waiting'));
  const storageState = await page.context().storageState();

  for (const width of [1440, 768, 390]) {
    const context = await browser.newContext({
      storageState,
      viewport: { width, height: width < 500 ? 844 : 900 },
    });
    const p = await context.newPage();
    let loads = 0;
    await p.goto(`/organizer/events/${eventId}/participants`);
    await expect(p.getByRole('row').nth(1)).toBeVisible();
    p.on('load', () => (loads += 1));
    await scrollTabsTo(p, OFFSET);

    for (const name of ['Waiting list', 'Staff', 'Settings', 'Overview', 'Check-in', 'Participants']) {
      await openTab(p, name);
      await expect.poll(() => tabsTop(p), { message: `${width}px, ${name}` }).toBe(OFFSET);
    }

    // A link inside a section that opens another section of the same event keeps the page too.
    await openTab(p, 'Overview');
    await p.getByRole('link', { name: 'Meet your participants' }).dispatchEvent('click', { button: 0 });
    await expect(p).toHaveURL(new RegExp(`/organizer/events/${eventId}/participants$`));
    await expect.poll(() => tabsTop(p)).toBe(OFFSET);

    // Search and an unsaved setting survive switching sections.
    await p.getByLabel('Search participants').fill('example.test');
    await openTab(p, 'Settings');
    await p.getByLabel('Event title').fill('Unsaved title');
    await openTab(p, 'Participants');
    await expect(p.getByLabel('Search participants')).toHaveValue('example.test');
    await openTab(p, 'Settings');
    await expect(p.getByLabel('Event title')).toHaveValue('Unsaved title');
    await expect.poll(() => tabsTop(p)).toBe(OFFSET);

    // Refreshing keeps the position.
    await p.getByRole('button', { name: 'Refresh event data' }).dispatchEvent('click');
    await expect(p.getByText(/^Updated \d/).filter({ visible: true })).toBeVisible();
    await expect.poll(() => tabsTop(p)).toBe(OFFSET);

    // Back and forward move between sections without a page load or a jump to the top.
    await p.goBack();
    await expect(p).toHaveURL(new RegExp(`/organizer/events/${eventId}/participants$`));
    expect(await scrollY(p)).toBeGreaterThan(0);
    await p.goForward();
    await expect(p).toHaveURL(new RegExp(`/organizer/events/${eventId}/settings$`));
    expect(await scrollY(p)).toBeGreaterThan(0);

    expect(loads).toBe(0);
    await context.close();
  }

  // Another event is a new view: it starts at the top.
  await page.goto(`/organizer/events/${eventId}`);
  await expect(tabs(page)).toBeVisible();
  await scrollTabsTo(page, OFFSET);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'All events' })
    .click();
  await expect.poll(() => scrollY(page)).toBe(0);
});

test('actions keep the page in place: capacity, staff invitation, waiting-list removal, cancellation', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, address('organizer'));
  const { eventId, publicUrl } = await createEvent(page, {
    title: `Actions ${Date.now()}`,
    capacity: 1,
    startsInMs: 72 * HOUR,
  });
  const first = address('first');
  const second = address('second');
  const third = address('third');
  await registerParticipant(browser, publicUrl, first);
  await registerParticipant(browser, publicUrl, second);
  await registerParticipant(browser, publicUrl, third);
  await page.goto(`/organizer/events/${eventId}/settings`);
  await expect(page.getByLabel('Number of seats')).toBeVisible();
  let loads = 0;
  page.on('load', () => (loads += 1));

  await scrollTabsTo(page, OFFSET);
  await page.getByLabel('Number of seats').fill('2');
  await page.getByRole('button', { name: 'Update capacity' }).dispatchEvent('click');
  await expect(page.getByText('Capacity is now 2.')).toBeVisible();
  await expect.poll(() => tabsTop(page)).toBe(OFFSET);

  await openTab(page, 'Staff');
  await page.getByLabel('Staff email address').fill(address('helper'));
  await page.getByRole('button', { name: 'Send invitation' }).dispatchEvent('click');
  await expect(page.getByText(/^Invitation sent to /)).toBeVisible();
  await expect.poll(() => tabsTop(page)).toBe(OFFSET);

  await openTab(page, 'Waiting list');
  await page
    .getByRole('row', { name: new RegExp(third) })
    .getByRole('button', { name: 'Remove from waiting list' })
    .dispatchEvent('click');
  await page.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(
    page.getByText(`${third} was removed from the waiting list and has been emailed.`),
  ).toBeVisible();
  await expect.poll(() => tabsTop(page)).toBe(OFFSET);

  await openTab(page, 'Participants');
  await page
    .getByRole('row', { name: new RegExp(first) })
    .getByRole('button', { name: 'Cancel registration' })
    .dispatchEvent('click');
  await page.getByRole('button', { name: 'Yes, cancel registration' }).click();
  await expect(page.getByText(new RegExp(`^The registration of ${first} was cancelled`))).toBeVisible();
  await expect.poll(() => tabsTop(page)).toBe(OFFSET);
  expect(loads).toBe(0);
});
