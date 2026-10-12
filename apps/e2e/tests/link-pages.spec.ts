import { expect, test, type Page } from './fixtures.js';
import {
  HOUR,
  address,
  createEvent,
  linkIn,
  openVerification,
  signIn,
  waitForMail,
  watchCsp,
} from './helpers.js';

// K-507 security guard for the redesigned participant pages (UI_INVENTORY §4, ADR-011): link pages load
// nothing from other origins, remove the token from the address bar, and keep it out of browser storage.

function watchRequests(page: Page, origin: string) {
  const foreign: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) foreign.push(url);
  });
  return foreign;
}

async function noTokenLeft(page: Page) {
  expect(page.url()).not.toContain('#');
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).toBe('{}');
}

test('event, verification, management and ticket pages stay same-origin and keep the token in memory only', async ({
  page,
  browser,
}) => {
  await signIn(page, address('organizer'));
  const { publicUrl } = await createEvent(page, {
    title: `Links ${Date.now()}`,
    capacity: 2,
    startsInMs: 72 * HOUR,
  });
  const origin = new URL(publicUrl).origin;
  const guest = address('guest');

  const context = await browser.newContext();
  const violations = await watchCsp(context);
  const participant = await context.newPage();
  const foreign = watchRequests(participant, origin);
  await openVerification(participant, publicUrl, guest);
  await noTokenLeft(participant);
  await participant.getByRole('button', { name: 'Confirm my registration' }).click();
  await expect(participant.getByRole('heading', { name: 'You are registered' })).toBeVisible();
  await noTokenLeft(participant);

  const [ticketMail] = await waitForMail(guest, 'Your ticket');
  await participant.goto(linkIn(ticketMail!, 'manage'));
  await expect(participant.getByText('Status: confirmed')).toBeVisible();
  await noTokenLeft(participant);
  await participant.goto(linkIn(ticketMail!, 'ticket'));
  await expect(participant.locator('.ticket-code')).toBeVisible();
  await noTokenLeft(participant);

  // The generic page for any invalid link, also without a token in the address bar afterwards.
  await participant.goto(`${origin}/manage#t=${'A'.repeat(43)}`);
  await expect(participant.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
  await noTokenLeft(participant);

  expect(foreign).toEqual([]);
  expect(violations).toEqual([]); // the strict policy does not break any link page

  // The production pages carry the FR-LNK-8 headers.
  for (const path of ['/verify', '/manage', '/ticket', `/e/${new URL(publicUrl).pathname.split('/e/')[1]}`]) {
    const headers = (await participant.request.get(`${origin}${path}`)).headers();
    expect(headers['content-security-policy'], path).toContain("script-src 'self'");
    expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'");
    expect(headers['cache-control'], path).toBe('no-store');
    expect(headers['referrer-policy'], path).toBe('no-referrer');
    expect(headers['x-robots-tag'], path).toContain('noindex');
  }
  await context.close();
});
