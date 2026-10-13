import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { expect, test, type BrowserContext, type Page } from './fixtures.js';
import { ageOrganizerSessions, seedOrganizer } from './db.js';
import { E2E_MAILBOX, ORIGIN, REPO_ROOT } from './env.js';
import {
  HOUR,
  REGISTER_BUTTON,
  address,
  checkInResult,
  linkIn,
  localIn,
  mailFor,
  openSection,
  openVerification,
  readResult,
  registerParticipant,
  reschedule,
  stat,
  waitForMail,
  watchCsp,
} from './helpers.js';

// K-722 (prompt 33, phase 7): the end-to-end product audit. Scenarios A to G run as complete journeys
// through the real web and worker processes and PostgreSQL, with synthetic accounts only (example.test,
// fake email provider). Every browser context is observed: uncaught page errors, console errors,
// Content-Security-Policy violations and any request leaving our origin fail the scenario. Console
// errors that are the browser's own report of an expected 4xx answer (for example 401 before sign-in)
// are listed in the scenario's report under var/e2e-audit, not counted as failures.

const PASSWORD = 'correct horse battery staple';
const ADMIN_PASSWORD = 'a long admin passphrase';
const REPORTS = resolve(REPO_ROOT, 'var/e2e-audit');
const EXPECTED_HTTP_ERROR = /^Failed to load resource: the server responded with a status of 4\d\d/;

interface Observation {
  pageErrors: string[];
  consoleErrors: string[];
  external: string[];
  csp: string[];
  requests: string[];
}

async function observe(context: BrowserContext, into: Observation, firstPage?: Page): Promise<void> {
  const csp = await watchCsp(context);
  into.csp = csp; // the same array keeps filling
  const watchPage = (p: Page) => p.on('pageerror', (e) => into.pageErrors.push(String(e)));
  if (firstPage) watchPage(firstPage);
  context.on('page', watchPage);
  context.on('console', (m) => {
    if (m.type() === 'error') into.consoleErrors.push(m.text());
  });
  context.on('request', (r) => {
    const url = r.url();
    into.requests.push(url);
    if (!url.startsWith(ORIGIN) && !url.startsWith('data:') && !url.startsWith('blob:'))
      into.external.push(url);
  });
}

function observation(): Observation {
  return { pageErrors: [], consoleErrors: [], external: [], csp: [], requests: [] };
}

/** Asserts the observations of one scenario and writes its report. */
function verdict(name: string, observations: Observation[], findings: Record<string, unknown> = {}) {
  mkdirSync(REPORTS, { recursive: true });
  const all = (k: keyof Observation) => observations.flatMap((o) => o[k]);
  const consoleErrors = all('consoleErrors');
  const unexpected = consoleErrors.filter((t) => !EXPECTED_HTTP_ERROR.test(t));
  writeFileSync(
    join(REPORTS, `${name}.json`),
    JSON.stringify(
      {
        scenario: name,
        at: new Date().toISOString(),
        requests: all('requests').length,
        external: all('external'),
        pageErrors: all('pageErrors'),
        cspViolations: all('csp'),
        unexpectedConsoleErrors: unexpected,
        expectedHttpErrorReports: consoleErrors.length - unexpected.length,
        ...findings,
      },
      null,
      2,
    ),
  );
  expect(all('pageErrors'), 'uncaught errors in the page').toEqual([]);
  expect(unexpected, 'console errors').toEqual([]);
  expect(all('csp'), 'Content-Security-Policy violations').toEqual([]);
  expect(all('external'), 'requests leaving our origin').toEqual([]);
}

/** `pnpm admin:create` as an operator runs it, against the test database, password on standard input. */
function createSuperAdmin(email: string) {
  if (!process.env.TEST_MIGRATION_DATABASE_URL) process.loadEnvFile(resolve(REPO_ROOT, '.env'));
  const run = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/entrypoints/admin.ts', 'create', '--email', email, '--name', 'Audit Admin'],
    {
      cwd: resolve(REPO_ROOT, 'apps/server'),
      env: { ...process.env, MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL },
      input: `${ADMIN_PASSWORD}\n`,
      encoding: 'utf8',
    },
  );
  expect(run.stdout).toContain(`Super Admin ${email} created`);
}

async function passwordSignIn(page: Page, email: string) {
  await page.goto('/organizer');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function organizerHeaders(page: Page) {
  const { csrfToken } = (await (await page.request.get('/api/auth/session')).json()) as { csrfToken: string };
  return { origin: ORIGIN, 'x-csrf-token': csrfToken };
}

/** A signed-in approved organizer (password sign-in through the UI). */
async function organizer(page: Page, name: string): Promise<string> {
  const email = address(name);
  await seedOrganizer(email, PASSWORD);
  await passwordSignIn(page, email);
  await expect(page.getByRole('heading', { level: 1, name: 'Good things happen together.' })).toBeVisible();
  return email;
}

async function createEventWithVenue(
  page: Page,
  input: { title: string; capacity: number; startsInMs: number; venue?: string },
) {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Create event' })
    .click();
  const [date, time] = localIn(input.startsInMs).split('T');
  await page.getByLabel('Event title').fill(input.title);
  await page.getByLabel('Description').fill('An event of the end-to-end product audit.');
  await page.getByLabel('Date', { exact: true }).fill(date!);
  await page.getByLabel('Start time').fill(time!);
  await page.getByLabel('Capacity').fill(String(input.capacity));
  await page.getByLabel('Venue name').fill(input.venue ?? 'Riverside Hall');
  await page.getByLabel('Street address').fill('12 Mill Lane');
  await page.getByLabel('City', { exact: true }).fill('Yerevan');
  await page.getByLabel('Country').fill('Armenia');
  await page.getByLabel('Latitude (optional)').fill('40.1811');
  await page.getByLabel('Longitude (optional)').fill('44.5136');
  await page.getByRole('button', { name: 'Create event' }).click();
  await page.waitForURL(/\/organizer\/events\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: input.title })).toBeVisible();
  const eventId = /\/organizer\/events\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  const publicUrl = await page.getByLabel('Public registration link').inputValue();
  return { eventId, publicUrl, publicId: publicUrl.split('/e/')[1]! };
}

/** A solid-colour PNG, encoded by hand (zlib only); no image files in the repository. */
function png(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set([r, g, b], 1 + x * 3);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const image = (name: string, buffer: Buffer) => ({ name, mimeType: 'image/png', buffer });

/** Layout shifts on the page since it loaded (the Cumulative Layout Shift sum). */
async function layoutShift(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((done) => {
        let sum = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[])
            if (!e.hadRecentInput) sum += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => done(sum), 500);
      }),
  );
}

async function noSidewaysScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, `content ${scroll}px wide in ${client}px`).toBeLessThanOrEqual(client);
}

test.describe.configure({ mode: 'serial' });

test('A. organization onboarding: register, verify, blocked until approved, approval, invitation, roles', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = observation();
  await observe(page.context(), owner, page);
  const email = address('founder');
  const orgName = `Audit Arts ${Date.now()}`;

  // 1. Register an organization.
  await page.goto('/organizer');
  await page.getByRole('link', { name: 'Register your organization' }).click();
  await page.getByLabel('Organization name').fill(orgName);
  await page.getByLabel('Contact person').fill('Ada Lovelace');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  // 2. Verify its email.
  const [confirm] = await waitForMail(email, 'Confirm your email address');
  await page.goto(linkIn(confirm!, 'verify-account'));
  await page.getByRole('button', { name: 'Confirm my email address' }).click();
  await expect(page.getByRole('heading', { name: 'Email address confirmed' })).toBeVisible();

  // 3. Access before approval: the organizer sees the waiting state, nothing to manage.
  await passwordSignIn(page, email);
  await expect(page.getByRole('heading', { name: 'Awaiting approval' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create event' })).toHaveCount(0);
  // 4. Event creation is refused by the server, not only hidden.
  const blocked = await page.request.post('/api/events', {
    headers: await organizerHeaders(page),
    data: {
      requestId: crypto.randomUUID(),
      title: 'Too early',
      localStart: localIn(72 * HOUR),
      timeZone: 'Europe/Berlin',
      capacity: 5,
    },
  });
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).code).toBe('organization_not_active');

  // 5. Approval through the Super Admin area (the admin was created by the operator command).
  const adminEmail = address('superadmin');
  createSuperAdmin(adminEmail);
  const adminContext = await browser.newContext();
  const admin = observation();
  await observe(adminContext, admin);
  const adminPage = await adminContext.newPage();
  await adminPage.goto('/admin');
  await adminPage.getByLabel('Email address').fill(adminEmail);
  await adminPage.getByLabel('Password').fill(ADMIN_PASSWORD);
  await adminPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(adminPage.getByRole('heading', { level: 1, name: 'Organizations' })).toBeVisible();
  const card = adminPage.getByRole('article', { name: orgName });
  await card.getByRole('button', { name: 'Approve' }).click();
  await adminPage.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(adminPage.getByText(`${orgName}: approved. The owners are being emailed.`)).toBeVisible();
  const [approved] = await waitForMail(email, 'Your organization was approved');
  expect(approved!.text).toContain(`"${orgName}" is approved`);
  await adminContext.close();

  // 6 and 7. The organizer signs in and opens the dashboard.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Good things happen together.' })).toBeVisible();
  await expect(page.getByText(`${orgName} · Owner`)).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Create event' }),
  ).toBeVisible();

  // 8. Invite another organizer, as a member.
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Organization' })
    .click();
  const invitee = address('member');
  await page.getByLabel('Email address').fill(invitee);
  await page.getByLabel('Role', { exact: true }).selectOption('member');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`Invitation email queued for ${invitee}.`)).toBeVisible();
  const memberContext = await browser.newContext();
  const memberObs = observation();
  await observe(memberContext, memberObs);
  const member = await memberContext.newPage();
  await member.goto('/organizer');
  await member.getByRole('link', { name: 'Invited to an organization? Create your account' }).click();
  await member.getByLabel('Your name').fill('Grace Hopper');
  await member.getByLabel('Email address').fill(invitee);
  await member.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await member.getByLabel('Confirm password').fill(PASSWORD);
  await member.getByRole('button', { name: 'Create account' }).click();
  const [memberConfirm] = await waitForMail(invitee, 'Confirm your email address');
  await member.goto(linkIn(memberConfirm!, 'verify-account'));
  await member.getByRole('button', { name: 'Confirm my email address' }).click();
  await expect(member.getByText('Your organizer account is ready.', { exact: false })).toBeVisible();
  await passwordSignIn(member, invitee);
  await member.getByRole('region', { name: 'Invitations' }).getByRole('button', { name: 'Accept' }).click();
  await expect(member.getByRole('heading', { level: 1, name: 'Good things happen together.' })).toBeVisible();

  // 9. Role-based permissions: a member manages events but not the organization's people.
  await member
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Organization' })
    .click();
  await expect(member.getByText('Grace Hopper')).toBeVisible();
  await expect(member.getByRole('button', { name: 'Send invitation' })).toHaveCount(0);
  const session = (await (await member.request.get('/api/auth/session')).json()) as {
    organizations: { organizationId: string; name: string; role: string }[];
  };
  const membership = session.organizations.find((o) => o.name === orgName)!;
  expect(membership.role).toBe('member');
  const memberInvite = await member.request.post(
    `/api/organizations/${membership.organizationId}/invitations`,
    { headers: await organizerHeaders(member), data: { email: address('someone'), role: 'member' } },
  );
  expect(memberInvite.status()).toBe(403);
  // The owner makes them an admin: now they may invite.
  await page.reload();
  await page.getByLabel('Role of Grace Hopper').selectOption('admin');
  await expect(page.getByText('Grace Hopper is now admin.')).toBeVisible();
  await member.reload();
  await expect(member.getByRole('button', { name: 'Send invitation' })).toBeVisible();
  await memberContext.close();

  verdict('A-onboarding', [owner, admin, memberObs]);
});

test('B. event creation: date, capacity, venue, cover and ordered gallery; public page on desktop and phone', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const org = observation();
  await observe(page.context(), org, page);
  await organizer(page, 'creator');
  const title = `Audit market ${Date.now()}`;
  // 1 to 4. Create the event with date, time, capacity, venue and address.
  const { publicUrl } = await createEventWithVenue(page, { title, capacity: 3, startsInMs: 96 * HOUR });

  // 5 to 7. A cover, several gallery photos, a new order.
  await openSection(page, 'Photos');
  await page.getByLabel('Add a cover').setInputFiles(image('cover.png', png(1200, 800, [239, 121, 89])));
  await expect(page.getByText('1 photo added.')).toBeVisible();
  await page
    .getByLabel('Add photos')
    .setInputFiles([
      image('stalls.png', png(900, 600, [93, 127, 95])),
      image('crowd.png', png(800, 800, [114, 97, 177])),
      image('lights.png', png(1000, 700, [230, 190, 80])),
    ]);
  await expect(page.getByText('3 photos added.')).toBeVisible();
  await page.getByLabel('Description of photo 3').fill('Lights over the square');
  await page.getByLabel('Description of photo 3').press('Enter');
  await expect(page.getByText('Description saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Move photo 3 earlier' }).click();
  await expect(page.getByText('Order saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Move photo 2 earlier' }).click();
  await expect(page.getByLabel('Description of photo 1')).toHaveValue('Lights over the square');

  // 8. The public presentation on a desktop.
  const findings: Record<string, unknown> = {};
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      ...(viewport.width < 500 ? { isMobile: true, hasTouch: true } : {}),
    });
    const visitor = observation();
    await observe(context, visitor);
    const p = await context.newPage();
    await p.goto(publicUrl);
    await expect(p.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(p.getByRole('region', { name: 'Location' }).getByText('Riverside Hall')).toBeVisible();
    await expect(p.locator('.public-art img.event-photo')).toHaveAttribute(
      'src',
      /^\/media\/images\/[0-9a-f]{32}\.webp$/,
    );
    const gallery = p.getByRole('region', { name: 'Photos' });
    await expect(gallery.getByRole('button')).toHaveCount(3);
    // The moved photo is first.
    await expect(gallery.getByRole('button').first()).toHaveAccessibleName(
      /^Open photo 1 of 3: Lights over the square$/,
    );
    await expect(p.getByRole('region', { name: 'Availability' }).locator('.status')).toHaveText(
      'Spots available',
    );
    await expect(p.getByRole('button', REGISTER_BUTTON)).toBeEnabled();
    // 9. Mobile layout: nothing scrolls sideways, images reserve their space (no layout shift), the
    // registration action is reachable.
    await p.waitForLoadState('networkidle');
    await noSidewaysScroll(p);
    const cls = await layoutShift(p);
    findings[`layoutShift${viewport.width}`] = cls;
    expect(cls, 'layout shift while the page and its images load').toBeLessThan(0.1);
    await p.getByRole('button', REGISTER_BUTTON).scrollIntoViewIfNeeded();
    await expect(p.getByRole('button', REGISTER_BUTTON)).toBeInViewport();
    mkdirSync(REPORTS, { recursive: true });
    await p.screenshot({ path: join(REPORTS, `B-public-${viewport.width}.png`), fullPage: true });
    await context.close();
    verdict(`B-public-${viewport.width}`, [visitor]);
  }
  verdict('B-event-creation', [org], findings);
});

test('C. registration: live availability, email-only registration, ticket and QR, full event, waiting list', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const org = observation();
  await observe(page.context(), org, page);
  await organizer(page, 'host');
  const { publicUrl } = await createEventWithVenue(page, {
    title: `Audit talk ${Date.now()}`,
    capacity: 2,
    startsInMs: 72 * HOUR,
  });

  // 1 and 2. The public page with live availability; it stays open (its refresh timer under test control).
  const visitorContext = await browser.newContext();
  const visitorObs = observation();
  await observe(visitorContext, visitorObs);
  const visitor = await visitorContext.newPage();
  await visitor.clock.install();
  let visitorLoads = 0;
  visitor.on('load', () => (visitorLoads += 1));
  await visitor.goto(publicUrl);
  const availability = visitor.getByRole('region', { name: 'Availability' });
  await expect(availability.locator('.status')).toHaveText('Spots available');
  await expect(availability.locator('.availability-figure strong')).toHaveText('2');
  // Email only: the registration form asks for nothing else.
  await expect(visitor.getByRole('main').getByRole('textbox')).toHaveCount(1);
  await expect(visitor.getByLabel('Email address')).toBeVisible();

  // 3 to 6. Email-only registration, confirmation, the ticket email, the code and the QR code.
  const participantContext = await browser.newContext();
  const participantObs = observation();
  await observe(participantContext, participantObs);
  const participant = await participantContext.newPage();
  const anna = address('anna');
  await openVerification(participant, publicUrl, anna);
  await participant.getByRole('button', { name: 'Confirm my registration' }).click();
  const result = await readResult(participant);
  expect(result.result).toBe('confirmed');
  expect(result.ticketCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
  await expect(
    participant.getByRole('img', { name: `QR code for ticket ${result.ticketCode}` }),
  ).toBeVisible();
  const [ticket] = await waitForMail(anna, 'Your ticket');
  expect(ticket!.text).toContain(result.ticketCode!);
  await participant.goto(linkIn(ticket!, 'manage'));
  await expect(
    participant.getByRole('img', { name: `QR code for ticket ${result.ticketCode}` }),
  ).toBeVisible();

  // 7. The event fills; 8. the next participant joins the waiting list; 9. their position.
  expect((await registerParticipant(browser, publicUrl, address('ben'))).result).toBe('confirmed');
  const carl = address('carl');
  const dana = address('dana');
  expect((await registerParticipant(browser, publicUrl, carl)).result).toBe('waitlisted');
  expect((await registerParticipant(browser, publicUrl, dana)).result).toBe('waitlisted');
  const [danaMail] = await waitForMail(dana, 'You are on the waiting list');
  await participant.goto('about:blank');
  await participant.goto(linkIn(danaMail!, 'manage'));
  await expect(participant.getByText('Waiting list · #2')).toBeVisible();

  // 10. The open public page follows by itself at its next refresh, without reloading.
  await visitor.clock.fastForward(16_000);
  await expect(availability.locator('.status')).toHaveText('Waiting list available');
  await expect(visitor.getByText('2 people waiting')).toBeVisible();
  await expect(visitor.getByRole('button', { name: 'Join waiting list' })).toBeEnabled();
  expect(visitorLoads).toBe(1);
  await visitorContext.close();
  await participantContext.close();
  verdict('C-registration', [org, visitorObs, participantObs]);
});

test('D. organizer cancels a participant: ticket invalid, notices, FIFO promotion, counts follow in place', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const org = observation();
  await observe(page.context(), org, page);
  await organizer(page, 'canceller');
  const { publicUrl } = await createEventWithVenue(page, {
    title: `Audit workshop ${Date.now()}`,
    capacity: 2,
    startsInMs: 72 * HOUR,
  });
  const anna = address('anna');
  const ben = address('ben');
  const first = address('first');
  const second = address('second');
  const { ticketCode: annaCode } = await registerParticipant(browser, publicUrl, anna);
  await registerParticipant(browser, publicUrl, ben);
  expect((await registerParticipant(browser, publicUrl, first)).result).toBe('waitlisted');
  expect((await registerParticipant(browser, publicUrl, second)).result).toBe('waitlisted');
  const [annaTicket] = await waitForMail(anna, 'Your ticket');

  const visitorContext = await browser.newContext();
  const visitorObs = observation();
  await observe(visitorContext, visitorObs);
  const visitor = await visitorContext.newPage();
  await visitor.clock.install();
  await visitor.goto(publicUrl);
  await expect(visitor.getByText('2 people waiting')).toBeVisible();

  // A short window, so the list scrolls; the organizer works at the bottom of it.
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.reload();
  await openSection(page, 'Participants');
  let loads = 0;
  page.on('load', () => (loads += 1));
  const annaRow = page.getByRole('row', { name: new RegExp(anna) });
  // Down to the list, instantly (a mouse wheel scrolls smoothly, and its position would still change).
  await annaRow.evaluate((row) => row.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const rowBefore = (await annaRow.boundingBox())!.y;
  expect(scrollBefore).toBeGreaterThan(0);

  // 1. Cancel the confirmed participant.
  await annaRow.getByRole('button', { name: 'Cancel registration' }).click();
  await page
    .getByRole('dialog', { name: 'Cancel this registration?' })
    .getByRole('button', { name: 'Yes, cancel registration' })
    .click();
  await expect(page.getByText(`The registration of ${anna} was cancelled`, { exact: false })).toBeVisible();
  // 4 and 6. The first waiting participant is promoted; the organizer's counts follow in place.
  await expect(page.getByRole('row', { name: new RegExp(first) })).toContainText('Confirmed');
  await expect(page.getByRole('row', { name: new RegExp(second) })).toContainText('Waiting');
  await expect(stat(page, 'Confirmed')).toHaveText('2');
  await expect(stat(page, 'Waiting list')).toHaveText('1');
  // 7. No page load and no jump: the row the organizer acted on stays where it was on the screen (the
  // confirmation above the list may push it by its own height) and the page did not go to the top.
  const scrollAfter = await page.evaluate(() => window.scrollY);
  const rowAfter = (await annaRow.boundingBox())!.y;
  expect(loads).toBe(0);
  expect(scrollAfter, 'the page went back to the top').toBeGreaterThan(0);
  await expect(annaRow).toBeInViewport();
  expect(Math.abs(rowAfter - rowBefore), `row at ${rowBefore}px, then ${rowAfter}px`).toBeLessThanOrEqual(
    120,
  );

  // 6. The open public page shows the new state at its next refresh.
  await visitor.clock.fastForward(16_000);
  await expect(visitor.getByText('1 person waiting')).toBeVisible();

  // 3 and 5. The cancellation notice and the promotion notice.
  const [notice] = await waitForMail(anna, 'Registration cancelled by the organizer');
  expect(notice!.text).not.toMatch(/#t=/);
  await waitForMail(first, 'A place became free');
  expect(mailFor(second, 'A place became free')).toHaveLength(0);

  // 2. The ticket is invalid: the management link is dead, and at the door the code is refused.
  const old = await browser.newContext();
  const oldPage = await old.newPage();
  await oldPage.goto(linkIn(annaTicket!, 'manage'));
  await expect(oldPage.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
  await old.close();
  await openSection(page, 'Settings');
  await reschedule(page, localIn(1 * HOUR));
  await openSection(page, 'Check-in');
  await page.getByLabel('Ticket code').fill(annaCode!);
  await page.getByRole('button', { name: 'Check in' }).click();
  await expect(checkInResult(page)).toHaveText('Ticket cancelled');

  await visitorContext.close();
  verdict('D-cancellation-fifo', [org, visitorObs], { scrollBefore, scrollAfter, rowBefore, rowAfter });
});

test('E. staff check-in: invitation, /staff, valid and duplicate tickets, live count, revocation', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const org = observation();
  await observe(page.context(), org, page);
  await organizer(page, 'doorowner');
  const title = `Audit door ${Date.now()}`;
  const { eventId, publicUrl } = await createEventWithVenue(page, {
    title,
    capacity: 3,
    startsInMs: 72 * HOUR,
  });
  const { ticketCode } = await registerParticipant(browser, publicUrl, address('guest'));
  await openSection(page, 'Settings');
  await reschedule(page, localIn(1 * HOUR));

  // 1. Invite staff.
  const helper = address('helper');
  await openSection(page, 'Staff');
  await page.getByLabel('Staff email address').fill(helper);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`Invitation sent to ${helper}.`)).toBeVisible();
  const [invitation] = await waitForMail(helper, 'You are invited to help with check-in');

  // 2 and 3. Accept on the staff phone; /staff opens.
  const device = await browser.newContext({
    viewport: { width: 390, height: 700 },
    isMobile: true,
    hasTouch: true,
  });
  const staffObs = observation();
  await observe(device, staffObs);
  const staff = await device.newPage();
  await staff.goto(linkIn(invitation!, 'invite'));
  await staff.getByRole('button', { name: 'Accept' }).click();
  await expect(staff).toHaveURL(/\/staff$/);
  await expect(staff.getByRole('heading', { name: `Check-in: ${title}` })).toBeVisible();

  // The owner watches the event's overview; its check-in count is live.
  await openSection(page, 'Overview');
  await expect(stat(page, 'Checked in')).toHaveText('0');
  let loads = 0;
  page.on('load', () => (loads += 1));

  // 4. A valid ticket; 5. the same ticket again.
  await staff.getByLabel('Ticket code').fill(ticketCode!);
  await staff.getByRole('button', { name: 'Check in' }).click();
  await expect(checkInResult(staff)).toHaveText('Checked in');
  await staff.getByLabel('Ticket code').fill(ticketCode!);
  await staff.getByRole('button', { name: 'Check in' }).click();
  await expect(checkInResult(staff)).toHaveText('Already checked in');
  // 6. The live count, on the staff phone and on the owner's open page without a reload.
  await expect(stat(staff, 'Checked in')).toHaveText('1');
  await expect(stat(page, 'Checked in')).toHaveText('1');
  expect(loads).toBe(0);

  // Staff can't use the organizer's API.
  expect((await staff.request.get(`/api/events/${eventId}/participants`)).status()).toBe(403);
  expect((await staff.request.get('/api/events')).status()).toBe(403);

  // 7. Revoke; 8. access stops at once.
  await openSection(page, 'Staff');
  await page.getByRole('button', { name: 'Revoke access' }).click();
  await expect(page.getByText('Staff access revoked.')).toBeVisible();
  await staff.reload();
  await expect(staff.getByRole('heading', { name: 'No check-in access' })).toBeVisible();
  const after = await staff.request.post(`/api/events/${eventId}/check-ins`, {
    headers: { origin: ORIGIN },
    data: { code: ticketCode, requestId: crypto.randomUUID() },
  });
  expect([401, 403]).toContain(after.status());
  await device.close();
  verdict('E-staff', [org, staffObs]);
});

test('F. lifecycle: reschedule and venue change notify participants; cancellation invalidates and closes', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const org = observation();
  await observe(page.context(), org, page);
  await organizer(page, 'planner');
  const { eventId, publicUrl, publicId } = await createEventWithVenue(page, {
    title: `Audit gala ${Date.now()}`,
    capacity: 1,
    startsInMs: 96 * HOUR,
  });
  const anna = address('anna');
  const ben = address('ben');
  const { ticketCode } = await registerParticipant(browser, publicUrl, anna);
  expect((await registerParticipant(browser, publicUrl, ben)).result).toBe('waitlisted');
  const [ticket] = await waitForMail(anna, 'Your ticket');
  const manageUrl = linkIn(ticket!, 'manage');

  // 1 and 2. Reschedule; confirmed and waiting participants are told.
  await openSection(page, 'Settings');
  await reschedule(page, localIn(120 * HOUR));
  await waitForMail(anna, 'Date changed');
  await waitForMail(ben, 'Date changed');

  // 3 and 4. Change the venue; participants are told, and their directions follow.
  await page.reload();
  await openSection(page, 'Settings');
  // A different place: name, street and coordinates.
  await page.getByLabel('Venue name').fill('Garden Pavilion');
  await page.getByLabel('Street address').fill('3 Garden Row');
  await page.getByLabel('Latitude (optional)').fill('40.1902');
  await page.getByLabel('Longitude (optional)').fill('44.5208');
  await page.getByRole('button', { name: 'Save location' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save and notify' }).click();
  await expect(page.getByText(/^Location saved\. Venue-change emails are queued/)).toBeVisible();
  const [venueMail] = await waitForMail(anna, 'Venue changed');
  expect(venueMail!.text).toContain('Garden Pavilion, 3 Garden Row, Yerevan, Armenia');
  const participantContext = await browser.newContext();
  const participantObs = observation();
  await observe(participantContext, participantObs);
  const participant = await participantContext.newPage();
  await participant.goto(manageUrl);
  const where = participant.getByRole('region', { name: 'Where to go' });
  await expect(where.getByText('Garden Pavilion')).toBeVisible();
  const directions = where.getByRole('link', { name: 'Get directions', exact: true });
  // Directions lead to the new coordinates (the place itself, not its old position).
  expect(decodeURIComponent((await directions.getAttribute('href'))!)).toContain(
    'destination=40.1902,44.5208',
  );
  await expect(where.getByText('3 Garden Row')).toBeVisible();
  expect(await directions.getAttribute('href')).not.toContain(manageUrl.split('#t=')[1]!);

  // 5. Cancel the event.
  const card = page.getByRole('region', { name: 'Cancel event' });
  await card.getByRole('button', { name: 'Cancel event' }).click();
  await card.getByRole('button', { name: 'Yes, cancel the event permanently' }).click();
  await expect(page.getByText('Status: CANCELLED.')).toBeVisible();
  // 7. Participant notices.
  await waitForMail(anna, 'Event cancelled');
  await waitForMail(ben, 'Event cancelled');
  // 6. Tickets are invalid at the door.
  await page.goto(`/organizer/events/${eventId}/check-in`);
  await page.getByLabel('Ticket code').fill(ticketCode!);
  await page.getByRole('button', { name: 'Check in' }).click();
  await expect(checkInResult(page)).toHaveText('Event cancelled');
  // 8. Public registration is closed, in the page and in the API.
  await participant.goto(publicUrl);
  await expect(participant.getByText('The organizer has cancelled this event.')).toBeVisible();
  await expect(participant.getByRole('button', { name: 'Event cancelled' })).toBeDisabled();
  const late = await participant.request.post(`/api/public/events/${publicId}/registrations`, {
    headers: { origin: ORIGIN },
    data: { email: address('late') },
  });
  expect(late.status()).toBe(409);
  expect((await late.json()).code).toBe('registration_closed');
  await participantContext.close();
  verdict('F-lifecycle', [org, participantObs]);
});

test('G. security: access control, consumed links, expired sessions, CSRF, uploads, rate limits, no token leaks', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const org = observation();
  await observe(page.context(), org, page);
  const ownerEmail = await organizer(page, 'secure');
  const { eventId, publicUrl, publicId } = await createEventWithVenue(page, {
    title: `Audit vault ${Date.now()}`,
    capacity: 5,
    startsInMs: 72 * HOUR,
  });
  const ownerHeaders = await organizerHeaders(page);
  const findings: Record<string, unknown> = {};

  // 1. Without a session: the API refuses, the organizer UI asks to sign in.
  const anonymous = await browser.newContext();
  const anonObs = observation();
  await observe(anonymous, anonObs);
  const anon = await anonymous.newPage();
  for (const path of ['/api/events', `/api/events/${eventId}`, `/api/events/${eventId}/participants`])
    expect((await anon.request.get(path)).status(), path).toBe(401);
  await anon.goto(`/organizer/events/${eventId}`);
  await expect(anon.getByRole('heading', { name: 'Organizer sign-in' })).toBeVisible();

  // 2. Another organization's organizer: the event does not exist for them.
  const otherContext = await browser.newContext();
  const otherObs = observation();
  await observe(otherContext, otherObs);
  const other = await otherContext.newPage();
  await organizer(other, 'intruder');
  const otherHeaders = await organizerHeaders(other);
  expect((await other.request.get(`/api/events/${eventId}`)).status()).toBe(404);
  expect((await other.request.get(`/api/events/${eventId}/participants`)).status()).toBe(404);
  const otherCancel = await other.request.post(`/api/events/${eventId}/cancellation`, {
    headers: otherHeaders,
    data: { confirmed: true },
  });
  expect([403, 404]).toContain(otherCancel.status());
  await other.goto(`/organizer/events/${eventId}`);
  await expect(other.getByText('Event not found.')).toBeVisible();

  // 3. Staff access to organizer APIs is covered in scenario E (403 for the participant list and the event list).

  // 4. Consumed links: a verification link and a sign-in link work once.
  const participantContext = await browser.newContext();
  const participantObs = observation();
  await observe(participantContext, participantObs);
  const participant = await participantContext.newPage();
  const guest = address('guest');
  await openVerification(participant, publicUrl, guest);
  await participant.getByRole('button', { name: 'Confirm my registration' }).click();
  expect((await readResult(participant)).result).toBe('confirmed');
  const [verifyMail] = await waitForMail(guest, 'Confirm your registration');
  await participant.goto('about:blank');
  await participant.goto(linkIn(verifyMail!, 'verify'));
  // Used once: it now only says so, and grants nothing (no second seat, no ticket or links shown).
  await expect(participant.getByRole('heading', { name: 'Already confirmed' })).toBeVisible();
  await expect(participant.getByRole('button', { name: 'Confirm my registration' })).toHaveCount(0);
  await expect(participant.locator('.ticket-code')).toHaveCount(0);
  const [ticketMail] = await waitForMail(guest, 'Your ticket');
  const manageUrl = linkIn(ticketMail!, 'manage');
  // The link page itself: no referrer, not stored, not indexed.
  const linkPage = await participant.request.get(new URL(manageUrl).pathname);
  expect(linkPage.headers()['referrer-policy']).toBe('no-referrer');
  expect(linkPage.headers()['cache-control']).toContain('no-store');

  // 5. An expired session (idle beyond its limit) is refused and the UI asks to sign in again.
  expect(await ageOrganizerSessions(ownerEmail, 169 * 60)).toBeGreaterThan(0);
  expect((await page.request.get('/api/events')).status()).toBe(401);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Organizer sign-in' })).toBeVisible();
  await passwordSignIn(page, ownerEmail);
  await expect(page.getByRole('heading', { level: 1, name: 'Good things happen together.' })).toBeVisible();
  expect((await page.request.post('/api/events', { headers: ownerHeaders, data: {} })).status()).toBe(403); // old CSRF token
  const fresh = await organizerHeaders(page);

  // 6. CSRF: without the token, or from another origin, a change is refused.
  const body = {
    requestId: crypto.randomUUID(),
    title: 'Forged',
    localStart: localIn(72 * HOUR),
    timeZone: 'Europe/Berlin',
    capacity: 5,
  };
  const noToken = await page.request.post('/api/events', { headers: { origin: ORIGIN }, data: body });
  expect(noToken.status()).toBe(403);
  expect((await noToken.json()).code).toBe('csrf_failed');
  const foreign = await page.request.post('/api/events', {
    headers: { ...fresh, origin: 'https://attacker.example' },
    data: body,
  });
  expect(foreign.status()).toBe(403);

  // 7. Upload validation: a disguised SVG and a non-image type are refused; nothing is stored.
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  const disguised = await page.request.post(`/api/events/${eventId}/images?role=gallery`, {
    headers: { ...fresh, 'content-type': 'image/png' },
    data: svg,
  });
  expect(disguised.status()).toBe(422);
  expect((await disguised.json()).code).toBe('image_rejected');
  const textUpload = await page.request.post(`/api/events/${eventId}/images?role=gallery`, {
    headers: { ...fresh, 'content-type': 'text/plain' },
    data: 'hello',
  });
  expect(textUpload.status()).toBe(415);
  const stored = (await (await page.request.get(`/api/events/${eventId}`)).json()) as { cover: unknown };
  expect(stored.cover).toBeNull();
  expect((await (await anon.request.get(`/api/public/events/${publicId}`)).json()).images).toEqual({
    cover: null,
    gallery: [],
  });

  // 8. Rate limiting: registrations from one address are limited (30 per 15 minutes per IP).
  const statuses: number[] = [];
  for (let i = 0; i < 31; i += 1) {
    const r = await anon.request.post(`/api/public/events/${publicId}/registrations`, {
      headers: { origin: ORIGIN },
      data: { email: address(`burst${i}`) },
    });
    statuses.push(r.status());
    if (r.status() === 429) {
      expect(Number(r.headers()['retry-after'])).toBeGreaterThan(0);
      break;
    }
  }
  findings.rateLimit = { requestsUntilLimited: statuses.length, last: statuses.at(-1) };
  expect(statuses.at(-1)).toBe(429);

  // 9. Sensitive links are never sent elsewhere nor written to the logs. Every request of every
  // context in this scenario stayed on our origin (checked by verdict), and none carried a token in its
  // URL; and no link token from any email the stack has sent so far appears in the web or worker log.
  const tokens = new Set<string>();
  for (const f of readdirSync(E2E_MAILBOX).filter((n) => n.endsWith('.json'))) {
    const text = (JSON.parse(readFileSync(join(E2E_MAILBOX, f), 'utf8')) as { text: string }).text;
    for (const m of text.matchAll(/#t=([A-Za-z0-9_-]{20,})/g)) tokens.add(m[1]!);
  }
  expect(tokens.size).toBeGreaterThan(0);
  const allRequests = [org, anonObs, otherObs, participantObs].flatMap((o) => o.requests);
  for (const url of allRequests) for (const t of tokens) expect(url).not.toContain(t);
  const logs = ['web', 'worker'].map((n) => resolve(REPO_ROOT, `var/e2e-logs/${n}.log`));
  let logBytes = 0;
  for (const file of logs) {
    expect(existsSync(file), file).toBe(true);
    const log = readFileSync(file, 'utf8');
    logBytes += log.length;
    for (const t of tokens) expect(log.includes(t), `a link token in ${file}`).toBe(false);
  }
  findings.tokensChecked = tokens.size;
  findings.logBytesChecked = logBytes;
  expect(logBytes).toBeGreaterThan(0);

  await Promise.all([anonymous.close(), otherContext.close(), participantContext.close()]);
  verdict('G-security', [org, anonObs, otherObs, participantObs], findings);
});
