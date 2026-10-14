import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from './fixtures.js';
import { REPO_ROOT } from './env.js';
import { HOUR, address, createEvent, linkIn, registerParticipant, signIn, waitForMail } from './helpers.js';

// K-715 (final review, prompt 29 phase 11): every main page at 1440, 768 and 390 px wide fits the
// screen without scrolling sideways. Screenshots of each page are kept under var/e2e-review for the
// visual review (not in Git).

const WIDTHS = [1440, 768, 390] as const;
const SHOTS = resolve(REPO_ROOT, 'var/e2e-review');

async function fits(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, `${label} scrolls sideways (${scroll}px content in ${client}px)`).toBeLessThanOrEqual(
    client,
  );
  await page.screenshot({ path: `${SHOTS}/${label}.png`, fullPage: true });
}

test('the main pages fit 1440, 768 and 390 px without sideways scrolling', async ({ page, browser }) => {
  test.setTimeout(240_000);
  mkdirSync(SHOTS, { recursive: true });
  await signIn(page, address('reviewer'));
  const { eventId, publicUrl } = await createEvent(page, {
    title: 'An evening with a rather long title for small screens',
    capacity: 2,
    startsInMs: 96 * HOUR,
  });
  const guest = address('guest');
  await registerParticipant(browser, publicUrl, guest);
  const [ticketMail] = await waitForMail(guest, 'Your ticket');
  const manageUrl = linkIn(ticketMail!, 'manage');

  const organizerPages: [string, string][] = [
    ['overview', '/organizer'],
    ['events', '/organizer/events'],
    ['create', '/organizer/events/new'],
    ['organization', '/organizer/organization'],
    ['event', `/organizer/events/${eventId}`],
    ['participants', `/organizer/events/${eventId}/participants`],
    ['staff', `/organizer/events/${eventId}/staff`],
    ['photos', `/organizer/events/${eventId}/photos`],
    ['settings', `/organizer/events/${eventId}/settings`],
  ];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, path] of organizerPages) {
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();
      await fits(page, `${width}-organizer-${name}`);
    }
    const visitor = await browser.newContext({ viewport: { width, height: 900 } });
    const p = await visitor.newPage();
    for (const [name, url] of [
      ['public', publicUrl],
      ['manage', manageUrl],
      ['admin-sign-in', '/admin'],
      ['organizer-sign-in', '/organizer'],
      ['register', '/organizer/register'],
    ] as const) {
      await p.goto(url);
      await expect(p.getByRole('heading').first()).toBeVisible();
      await fits(p, `${width}-${name}`);
    }
    await visitor.close();
  }
});
