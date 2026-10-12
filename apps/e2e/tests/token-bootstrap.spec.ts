import { expect, test, type Browser, type Page } from './fixtures.js';
import { HOUR, address, createEvent, linkIn, openSection, signIn, waitForMail } from './helpers.js';

// PD-71, FR-LNK-10 (b), ADR-011 — against the PRODUCTION build served by the real web server.
// Every JavaScript chunk except the HTML entry is instrumented on the wire: one statement is prepended
// that records location.hash at the moment that chunk executes. fetch is wrapped (before any page
// script) to record location.hash at every request. If any application module ran, or any request was
// made, before the bootstrap captured the token, it would have seen "#t=…".

type Instrumented = { page: Page; close: () => Promise<void> };

async function openInstrumented(browser: Browser, url: string): Promise<Instrumented> {
  const context = await browser.newContext();
  const target = new URL(url);
  // The page HTML (no fragment is ever sent) tells which chunk is the entry.
  const html = await (await context.request.get(`${target.origin}${target.pathname}`)).text();
  const entry = /<script type="module"[^>]*src="([^"]+)"/.exec(html)![1]!;
  await context.addInitScript(() => {
    const w = window as unknown as { __seen: [string, string][]; __fetches: [string, string][] };
    w.__seen = [];
    w.__fetches = [];
    const original = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      w.__fetches.push([String(input instanceof Request ? input.url : input), location.hash]);
      return original(input, init);
    };
  });
  await context.route('**/assets/*.js', async (route) => {
    const response = await route.fetch();
    const path = new URL(route.request().url()).pathname;
    const body = await response.text();
    const probe = `(globalThis.__seen||(globalThis.__seen=[])).push([${JSON.stringify(path)},location.hash]);\n`;
    await route.fulfill({ response, body: path === entry ? body : probe + body });
  });
  const page = await context.newPage();
  const linkRequests: { url: string; authorization?: string }[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/links/'))
      linkRequests.push({ url: r.url(), authorization: r.headers()['authorization'] });
  });
  await page.goto(url);
  (page as unknown as { linkRequests: typeof linkRequests }).linkRequests = linkRequests;
  return { page, close: () => context.close() };
}

async function expectCapturedFirst(page: Page, token: string | null) {
  const { seen, fetches } = await page.evaluate(() => {
    const w = window as unknown as { __seen: [string, string][]; __fetches: [string, string][] };
    return { seen: w.__seen, fetches: w.__fetches };
  });
  // The instrumentation really ran: the React application and shared chunks executed.
  expect(seen.length).toBeGreaterThan(1);
  expect(seen.some(([chunk]) => /\/assets\/ui-/.test(chunk))).toBe(true);
  for (const [chunk, hash] of seen) expect(hash, `${chunk} executed before the token was captured`).toBe('');
  expect(fetches.length).toBeGreaterThan(0);
  for (const [url, hash] of fetches) expect(hash, `request to ${url} before the capture`).toBe('');
  // The address bar and the current history entry are clean; nothing reached browser storage.
  expect(page.url()).not.toContain('#');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).toBe('{}');
  // The token travelled only in the Authorization header, never in a URL.
  const requests = (page as unknown as { linkRequests: { url: string; authorization?: string }[] })
    .linkRequests;
  expect(requests.length).toBeGreaterThan(0);
  for (const r of requests) {
    if (token) {
      expect(r.url).not.toContain(token);
      expect(r.authorization).toBe(`Link ${token}`);
    }
  }
}

const tokenOf = (url: string) => url.split('#t=')[1]!;

test('production bundle: the link token is captured before any application module or request runs (PD-71)', async ({
  page,
  browser,
}) => {
  await signIn(page, address('organizer'));
  const { publicUrl } = await createEvent(page, {
    title: `Bootstrap ${Date.now()}`,
    capacity: 2,
    startsInMs: 72 * HOUR,
  });

  // A registration to obtain a real verification link (opened in an uninstrumented browser first).
  const guest = address('guest');
  const helper = await (await browser.newContext()).newPage();
  await helper.goto(publicUrl);
  await helper.getByLabel('Email address').fill(guest);
  await helper.getByRole('button', { name: 'Register' }).click();
  await expect(helper.getByText('Check your email.')).toBeVisible();
  const verifyUrl = linkIn((await waitForMail(guest, 'Confirm your registration'))[0]!, 'verify');

  // Verification: read-only view, then the explicit confirm, both with the in-memory token.
  const verify = await openInstrumented(browser, verifyUrl);
  await expect(verify.page.getByRole('button', { name: 'Confirm my registration' })).toBeVisible();
  await expectCapturedFirst(verify.page, tokenOf(verifyUrl));
  await verify.page.getByRole('button', { name: 'Confirm my registration' }).click();
  await expect(verify.page.getByRole('heading', { name: 'You are registered' })).toBeVisible();
  await expectCapturedFirst(verify.page, tokenOf(verifyUrl));
  await verify.close();

  const [ticketMail] = await waitForMail(guest, 'Your ticket');
  for (const [path, ready] of [
    ['manage', (p: Page) => p.getByText('Status: confirmed')],
    ['ticket', (p: Page) => p.locator('.ticket-code')],
  ] as const) {
    const url = linkIn(ticketMail!, path);
    const opened = await openInstrumented(browser, url);
    await expect(ready(opened.page)).toBeVisible();
    await expectCapturedFirst(opened.page, tokenOf(url));
    await opened.close();
  }

  // Sign-in confirmation page (not confirmed here).
  const other = address('other-organizer');
  await page.request.post('/api/auth/sign-in-requests', {
    headers: { origin: new URL(publicUrl).origin },
    data: { email: other },
  });
  const signInUrl = linkIn((await waitForMail(other, 'Your sign-in link'))[0]!, 'sign-in');
  const signInPage = await openInstrumented(browser, signInUrl);
  await expect(signInPage.page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expectCapturedFirst(signInPage.page, tokenOf(signInUrl));
  await signInPage.close();

  // Staff invitation page.
  await openSection(page, 'Staff');
  const staffEmail = address('door');
  await page.getByLabel('Staff email address').fill(staffEmail);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  const inviteUrl = linkIn((await waitForMail(staffEmail, 'You are invited'))[0]!, 'invite');
  const invite = await openInstrumented(browser, inviteUrl);
  await expect(invite.page.getByRole('heading', { name: 'Check-in invitation' })).toBeVisible();
  await expectCapturedFirst(invite.page, tokenOf(inviteUrl));
  await invite.close();

  // An invalid link: the same generic page, and the bogus fragment is gone just as early.
  const bogus = `${new URL(publicUrl).origin}/manage#t=${'A'.repeat(43)}`;
  const invalid = await openInstrumented(browser, bogus);
  await expect(invalid.page.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
  await expectCapturedFirst(invalid.page, tokenOf(bogus));
  await invalid.close();
});
