import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { expect, test, type BrowserContext, type Page } from './fixtures.js';
import { seedOrganizer } from './db.js';
import { ORIGIN, REPO_ROOT } from './env.js';
import {
  HOUR,
  address,
  linkIn,
  localIn,
  openSection,
  registerParticipant,
  waitForMail,
  watchCsp,
} from './helpers.js';

// K-722 (prompt 33, phase 8): the device audit. Every page the prompt names, at 1440, 768 and 390 px,
// in the real application with real data (a venue with a map, a cover and a gallery, confirmed and
// waiting participants, a staff device, a Super Admin). On each page: nothing scrolls sideways, no
// action button is cut off at the screen's edge, images reserve their space (layout shift below 0.1),
// no uncaught error, no console error other than the browser's report of an expected 4xx answer, no
// Content-Security-Policy violation and no request leaving our origin. The automatic refresh of the
// organizer pages keeps the scroll position and unsaved input. Screenshots and a report are written to
// var/e2e-audit/devices for the visual review. A camera cannot be tested here: physical scanning with a
// real phone camera remains unverified (camera-scan.spec.ts uses a simulated camera).

const PASSWORD = 'correct horse battery staple';
const ADMIN_PASSWORD = 'a long admin passphrase';
const WIDTHS = [1440, 768, 390] as const;
const OUT = resolve(REPO_ROOT, 'var/e2e-audit/devices');
const EXPECTED_HTTP_ERROR = /^Failed to load resource: the server responded with a status of 4\d\d/;

interface Problems {
  pageErrors: string[];
  consoleErrors: string[];
  external: string[];
  csp: string[];
}

async function watch(context: BrowserContext): Promise<Problems> {
  const problems: Problems = { pageErrors: [], consoleErrors: [], external: [], csp: [] };
  problems.csp = await watchCsp(context);
  context.on('page', (p) => p.on('pageerror', (e) => problems.pageErrors.push(String(e))));
  context.on('console', (m) => {
    if (m.type() === 'error' && !EXPECTED_HTTP_ERROR.test(m.text())) problems.consoleErrors.push(m.text());
  });
  context.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(ORIGIN) && !url.startsWith('data:') && !url.startsWith('blob:'))
      problems.external.push(url);
  });
  return problems;
}

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

interface PageResult {
  page: string;
  width: number;
  viewport: number;
  contentWidth: number;
  layoutShift: number;
  clippedActions: string[];
}

/** Checks the page as shown now and keeps a screenshot. */
async function inspect(page: Page, label: string, width: number, results: PageResult[]) {
  await page.waitForLoadState('networkidle');
  const measured = await page.evaluate(
    () =>
      new Promise<{ contentWidth: number; viewport: number; layoutShift: number; clipped: string[] }>(
        (done) => {
          let shift = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[])
              if (!e.hadRecentInput) shift += e.value;
          }).observe({ type: 'layout-shift', buffered: true });
          const viewport = document.documentElement.clientWidth;
          // Visible actions whose box reaches beyond the screen's left or right edge.
          const clipped: string[] = [];
          for (const el of document.querySelectorAll<HTMLElement>(
            'main button, main a[href], main [role="button"]',
          )) {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            if (r.width === 0 || r.height === 0 || style.visibility === 'hidden') continue;
            if (r.right > viewport + 1 || r.left < -1)
              clipped.push(
                `${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)} [${Math.round(r.left)}..${Math.round(r.right)}]`,
              );
          }
          setTimeout(
            () =>
              done({
                contentWidth: document.documentElement.scrollWidth,
                viewport,
                layoutShift: Math.round(shift * 1000) / 1000,
                clipped,
              }),
            400,
          );
        },
      ),
  );
  results.push({
    page: label,
    width,
    viewport: measured.viewport,
    contentWidth: measured.contentWidth,
    layoutShift: measured.layoutShift,
    clippedActions: measured.clipped,
  });
  await page.screenshot({ path: join(OUT, `${width}-${label}.png`), fullPage: true });
}

test('every audited page at 1440, 768 and 390 px: no sideways scroll, no cut-off actions, no shifts, no errors', async ({
  page,
  browser,
}) => {
  test.setTimeout(420_000);
  mkdirSync(OUT, { recursive: true });
  const results: PageResult[] = [];
  const problems: Problems[] = [await watch(page.context())];
  page.on('pageerror', (e) => problems[0]!.pageErrors.push(String(e)));

  // The data: an organizer, an event with a venue and coordinates, a cover and a gallery, one confirmed
  // and one waiting participant, an accepted staff device, a pending organization, a Super Admin.
  const organizer = address('devices');
  await seedOrganizer(organizer, PASSWORD);
  await page.goto('/organizer');
  await page.getByLabel('Email address').fill(organizer);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Create event' })
    .click();
  const [date, time] = localIn(72 * HOUR).split('T');
  await page.getByLabel('Event title').fill('Lantern evening on the river terrace');
  await page.getByLabel('Description').fill('An evening of lanterns, music and food by the river.');
  await page.getByLabel('Date', { exact: true }).fill(date!);
  await page.getByLabel('Start time').fill(time!);
  await page.getByLabel('Capacity').fill('1');
  await page.getByLabel('Venue name').fill('River Terrace');
  await page.getByLabel('Street address').fill('5 Embankment Street');
  await page.getByLabel('City', { exact: true }).fill('Yerevan');
  await page.getByLabel('Country').fill('Armenia');
  await page.getByLabel('Latitude (optional)').fill('40.1811');
  await page.getByLabel('Longitude (optional)').fill('44.5136');
  await page.getByRole('button', { name: 'Create event' }).click();
  await page.waitForURL(/\/organizer\/events\/[0-9a-f-]{36}$/);
  const eventId = /\/organizer\/events\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  const publicUrl = await page.getByLabel('Public registration link').inputValue();
  await openSection(page, 'Photos');
  await page.getByLabel('Add a cover').setInputFiles({
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: png(1600, 900, [233, 120, 80]),
  });
  await expect(page.getByText('1 photo added.')).toBeVisible();
  await page.getByLabel('Add photos').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: png(900, 600, [90, 130, 100]) },
    { name: 'b.png', mimeType: 'image/png', buffer: png(700, 900, [120, 100, 180]) },
  ]);
  await expect(page.getByText('2 photos added.')).toBeVisible();
  const confirmed = address('lena');
  expect((await registerParticipant(browser, publicUrl, confirmed)).result).toBe('confirmed');
  expect((await registerParticipant(browser, publicUrl, address('mark'))).result).toBe('waitlisted');
  const [ticketMail] = await waitForMail(confirmed, 'Your ticket');
  const manageUrl = linkIn(ticketMail!, 'manage');
  const ticketUrl = linkIn(ticketMail!, 'ticket');
  const helper = address('door');
  await openSection(page, 'Staff');
  await page.getByLabel('Staff email address').fill(helper);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  const [invitation] = await waitForMail(helper, 'You are invited to help with check-in');
  const staffContext = await browser.newContext();
  problems.push(await watch(staffContext));
  const staff = await staffContext.newPage();
  await staff.goto(linkIn(invitation!, 'invite'));
  await staff.getByRole('button', { name: 'Accept' }).click();
  await expect(staff).toHaveURL(/\/staff$/);
  const pending = address('pending');
  const registration = await page.request.post('/api/organizations/registrations', {
    headers: { origin: ORIGIN },
    data: {
      organizationName: 'Northern Lights Collective',
      contactName: 'Ada',
      email: pending,
      password: PASSWORD,
    },
  });
  expect(registration.status()).toBe(202);
  const [confirmMail] = await waitForMail(pending, 'Confirm your email address');
  const confirmContext = await browser.newContext();
  const confirmPage = await confirmContext.newPage();
  await confirmPage.goto(linkIn(confirmMail!, 'verify-account'));
  await confirmPage.getByRole('button', { name: 'Confirm my email address' }).click();
  await expect(confirmPage.getByRole('heading', { name: 'Email address confirmed' })).toBeVisible();
  await confirmContext.close();
  if (!process.env.TEST_MIGRATION_DATABASE_URL) process.loadEnvFile(resolve(REPO_ROOT, '.env'));
  const adminEmail = address('admin');
  spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/entrypoints/admin.ts',
      'create',
      '--email',
      adminEmail,
      '--name',
      'Device Audit',
    ],
    {
      cwd: resolve(REPO_ROOT, 'apps/server'),
      env: { ...process.env, MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL },
      input: `${ADMIN_PASSWORD}\n`,
      encoding: 'utf8',
    },
  );
  const adminContext = await browser.newContext();
  problems.push(await watch(adminContext));
  const admin = await adminContext.newPage();
  await admin.goto('/admin');
  await admin.getByLabel('Email address').fill(adminEmail);
  await admin.getByLabel('Password').fill(ADMIN_PASSWORD);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await expect(admin.getByRole('heading', { level: 1, name: 'Organizations' })).toBeVisible();

  const organizerPages: [string, string, string][] = [
    ['organizer-dashboard', '/organizer', 'Good things happen together.'],
    ['event-creation', '/organizer/events/new', 'Something great starts here.'],
    ['event-overview', `/organizer/events/${eventId}`, 'Lantern evening on the river terrace'],
    ['participants', `/organizer/events/${eventId}/participants`, 'Lantern evening on the river terrace'],
    ['waiting-list', `/organizer/events/${eventId}/waiting-list`, 'Lantern evening on the river terrace'],
    ['check-in', `/organizer/events/${eventId}/check-in`, 'Lantern evening on the river terrace'],
    ['staff', `/organizer/events/${eventId}/staff`, 'Lantern evening on the river terrace'],
    ['gallery', `/organizer/events/${eventId}/photos`, 'Lantern evening on the river terrace'],
    ['settings', `/organizer/events/${eventId}/settings`, 'Lantern evening on the river terrace'],
  ];

  for (const width of WIDTHS) {
    const viewport = { width, height: width < 500 ? 844 : 900 };
    await page.setViewportSize(viewport);
    for (const [label, path, heading] of organizerPages) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await inspect(page, label, width, results);
    }
    await admin.setViewportSize(viewport);
    await admin.reload();
    await expect(admin.getByRole('article', { name: 'Northern Lights Collective' })).toBeVisible();
    await inspect(admin, 'super-admin', width, results);
    await staff.setViewportSize(viewport);
    await staff.reload();
    await expect(staff.getByLabel('Ticket code')).toBeVisible();
    await inspect(staff, 'staff-device', width, results);

    // Visitors and the participant, each page in a fresh context of this size.
    const visitor = await browser.newContext({
      viewport,
      ...(width < 500 ? { isMobile: true, hasTouch: true } : {}),
    });
    problems.push(await watch(visitor));
    const v = await visitor.newPage();
    await v.goto('/organizer/register');
    await expect(v.getByLabel('Organization name')).toBeVisible();
    await inspect(v, 'organization-registration', width, results);
    await v.goto(publicUrl);
    await expect(v.getByRole('region', { name: 'Availability' })).toBeVisible();
    await inspect(v, 'public-availability', width, results);
    await v.getByRole('region', { name: 'Photos' }).getByRole('button').first().click();
    await expect(v.getByRole('dialog')).toBeVisible();
    await inspect(v, 'public-gallery-viewer', width, results);
    await v.keyboard.press('Escape');
    await v.goto(manageUrl);
    await expect(v.getByRole('img', { name: /^QR code for ticket / })).toBeVisible();
    // The participant map: tiles load through our origin, the venue is in view.
    await expect(v.locator('.map-canvas')).toBeVisible();
    await v.locator('.map-canvas').scrollIntoViewIfNeeded();
    await expect(v.locator('.leaflet-tile-loaded').first()).toBeVisible();
    await inspect(v, 'participant-ticket-and-map', width, results);
    await v.goto('about:blank');
    await v.goto(ticketUrl);
    await expect(v.getByRole('img', { name: /^QR code for ticket / })).toBeVisible();
    await inspect(v, 'shared-ticket', width, results);
    await visitor.close();
  }

  // The organizer page's automatic refresh (every 15 s) keeps the reader's place and unsaved input.
  const refresh: Record<string, unknown>[] = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 700 },
      storageState: await page.context().storageState(),
    });
    problems.push(await watch(context));
    const p = await context.newPage();
    await p.clock.install();
    await p.goto(`/organizer/events/${eventId}/settings`);
    const description = p.getByLabel('Event description');
    await description.fill('An unsaved new description');
    await p.evaluate(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
    );
    const before = await p.evaluate(() => window.scrollY);
    let reloads = 0;
    p.on('load', () => (reloads += 1));
    let dashboardPolls = 0;
    p.on('request', (r) => {
      if (r.url().endsWith(`/api/events/${eventId}/dashboard`)) dashboardPolls += 1;
    });
    await p.clock.fastForward(16_000);
    await expect.poll(() => dashboardPolls).toBeGreaterThan(0); // the refresh did run
    await p.waitForLoadState('networkidle');
    const after = await p.evaluate(() => window.scrollY);
    await expect(description).toHaveValue('An unsaved new description');
    expect(reloads).toBe(0);
    expect(after, `scroll ${before} -> ${after}`).toBe(before);
    refresh.push({ width, scrollBefore: before, scrollAfter: after, dashboardPolls, unsavedInputKept: true });
    await context.close();
  }

  writeFileSync(
    join(OUT, 'report.json'),
    JSON.stringify({ at: new Date().toISOString(), results, refresh, problems }, null, 2),
  );
  for (const r of results) {
    expect(
      r.contentWidth,
      `${r.width}-${r.page}: content ${r.contentWidth}px in ${r.viewport}px`,
    ).toBeLessThanOrEqual(r.viewport);
    expect(r.clippedActions, `${r.width}-${r.page}: actions cut off at the edge`).toEqual([]);
    expect(r.layoutShift, `${r.width}-${r.page}: layout shift`).toBeLessThan(0.1);
  }
  for (const key of ['pageErrors', 'consoleErrors', 'csp', 'external'] as const)
    expect(
      problems.flatMap((p) => p[key]),
      key,
    ).toEqual([]);
});
