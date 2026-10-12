import { expect, test, type Page } from './fixtures.js';
import {
  HOUR,
  REGISTER_BUTTON,
  address,
  createEvent,
  linkIn,
  registerParticipant,
  signIn,
  waitForMail,
  watchCsp,
} from './helpers.js';
import { ORIGIN } from './env.js';

// PD-81: the public event page shows live availability and refreshes it in place. The visitor's page
// stays open for the whole test while other participants and the organizer act through the real
// application; the page's 15-second refresh timer is advanced with Playwright's clock instead of waiting.

const REFRESH = 16_000;

async function organizerApi(page: Page) {
  const { csrfToken } = (await (await page.request.get('/api/auth/session')).json()) as { csrfToken: string };
  return { origin: ORIGIN, 'x-csrf-token': csrfToken };
}

test('the public page shows live availability and follows every change without reloading', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  await signIn(page, address('organizer'));
  const { eventId, publicUrl } = await createEvent(page, {
    title: `Availability ${Date.now()}`,
    capacity: 2,
    startsInMs: 72 * HOUR,
  });

  // The visitor: a separate browser context, CSP violations recorded, the clock under test control.
  const visitorContext = await browser.newContext();
  const violations = await watchCsp(visitorContext);
  const visitor = await visitorContext.newPage();
  const bodies: string[] = [];
  visitor.on('response', async (r) => {
    if (r.url().includes('/api/public/events/') && r.request().method() === 'GET')
      bodies.push(await r.text());
  });
  let loads = 0;
  visitor.on('load', () => (loads += 1));
  await visitor.clock.install();
  await visitor.goto(publicUrl);

  const panel = visitor.getByRole('region', { name: 'Availability' });
  const tick = async () => visitor.clock.fastForward(REFRESH);
  const badge = panel.locator('.status');

  // 1. Seats are available.
  await expect(badge).toHaveText('Spots available');
  await expect(panel.locator('.availability-figure strong')).toHaveText('2');
  await expect(panel.locator('.availability-figure')).toContainText('2seats leftof 2 seats');
  await expect(visitor.getByRole('button', { name: 'Register for event' })).toBeEnabled();
  await expect(
    visitor.getByText('Your place is determined when you confirm your email. Availability may change.'),
  ).toBeVisible();

  // Another visitor submits an email: the verification instructions, not a confirmation; no seat is
  // reserved, so the open page still shows two free seats after a refresh (FR-REG-2).
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await other.goto(publicUrl);
  await other.getByLabel('Email address').fill(address('pending'));
  await other.getByRole('button', REGISTER_BUTTON).click();
  await expect(other.getByText('Check your email.')).toBeVisible();
  await expect(other.locator('.registration-result')).toContainText('decided when you confirm');
  await otherContext.close();
  await tick();
  await expect(panel.locator('.availability-figure strong')).toHaveText('2');

  // A confirmation elsewhere: one seat left, without a reload.
  const first = address('first');
  expect((await registerParticipant(browser, publicUrl, first)).result).toBe('confirmed');
  await tick();
  await expect(panel.locator('.availability-figure strong')).toHaveText('1');
  await expect(panel.locator('.availability-figure')).toContainText('1seat leftof 2 seats');

  // 2 and 9. Two visitors confirm for the final seat at the same moment: one seat, one waiting place.
  const results = await Promise.all([
    registerParticipant(browser, publicUrl, address('racer-a')),
    registerParticipant(browser, publicUrl, address('racer-b')),
  ]);
  expect(results.map((r) => r.result).sort()).toEqual(['confirmed', 'waitlisted']);
  await tick();

  // 3. Full: the waiting list is offered, with the number of people waiting.
  await expect(badge).toHaveText('Waiting list available');
  await expect(panel.getByText('of 2 seats taken')).toBeVisible();
  await expect(panel.getByText('1 person waiting')).toBeVisible();
  await expect(visitor.getByText(/you can still register to join the waiting list/)).toBeVisible();

  // 4. A cancellation promotes the first person waiting (FIFO): still full, nobody waiting.
  const [ticketMail] = await waitForMail(first, 'Your ticket');
  const manageToken = linkIn(ticketMail!, 'manage').split('#t=')[1]!;
  const cancelled = await page.request.post('/api/links/manage/cancel', {
    headers: { origin: ORIGIN, authorization: `Link ${manageToken}` },
    data: { confirmed: true },
  });
  expect(cancelled.status()).toBe(200);
  // Returning to the tab a few seconds later refreshes at once, without waiting for the timer.
  await visitor.clock.fastForward(3_000);
  await visitor.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(panel.getByText('No one is waiting yet')).toBeVisible();
  await expect(badge).toHaveText('Waiting list available');

  // 5. A capacity increase frees seats.
  const raised = await page.request.put(`/api/events/${eventId}/capacity`, {
    headers: await organizerApi(page),
    data: { capacity: 4 },
  });
  expect(raised.status()).toBe(200);
  await tick();
  await expect(badge).toHaveText('Spots available');
  await expect(panel.locator('.availability-figure strong')).toHaveText('2');
  await expect(visitor.getByRole('button', { name: 'Register for event' })).toBeEnabled();

  // 7. The organizer cancels the event: registration is disabled.
  const cancelEvent = await page.request.post(`/api/events/${eventId}/cancellation`, {
    headers: await organizerApi(page),
    data: { confirmed: true },
  });
  expect(cancelEvent.status()).toBe(200);
  await tick();
  await expect(badge).toHaveText('Event cancelled');
  await expect(visitor.getByRole('button', { name: 'Event cancelled' })).toBeDisabled();
  await expect(visitor.getByLabel('Email address')).toBeDisabled();

  // 8. All of this happened in one page load; 10. no response carried personal data.
  expect(loads).toBe(1);
  expect(bodies.length).toBeGreaterThanOrEqual(6);
  for (const body of bodies) expect(body).not.toContain('@');
  expect(violations).toEqual([]);
  await visitorContext.close();
});
