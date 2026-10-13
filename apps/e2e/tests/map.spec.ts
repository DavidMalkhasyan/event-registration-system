import { expect, test, type Page } from './fixtures.js';
import { ORIGIN } from './env.js';
import {
  HOUR,
  address,
  linkIn,
  localIn,
  registerParticipant,
  signIn,
  waitForMail,
  watchCsp,
} from './helpers.js';

// K-714 in the browser (PD-96): confirmed participants see a real map of the venue. Every request stays
// on our origin (tiles through the identified, bounded proxy; here backed by the stack's local stand-in
// for the tile service), no request carries the link token, and the strict CSP holds.

async function eventWithVenue(page: Page, title: string, coordinates: [string, string] | null) {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Create event' })
    .click();
  const [date, time] = localIn(72 * HOUR).split('T');
  await page.getByLabel('Event title').fill(title);
  await page.getByLabel('Date', { exact: true }).fill(date!);
  await page.getByLabel('Start time').fill(time!);
  await page.getByLabel('Capacity').fill('5');
  await page.getByLabel('Venue name').fill('Riverside Hall');
  await page.getByLabel('Street address').fill('12 Mill Lane');
  await page.getByLabel('City', { exact: true }).fill('Yerevan');
  await page.getByLabel('Country').fill('Armenia');
  if (coordinates) {
    await page.getByLabel('Latitude (optional)').fill(coordinates[0]);
    await page.getByLabel('Longitude (optional)').fill(coordinates[1]);
  }
  await page.getByRole('button', { name: 'Create event' }).click();
  await page.waitForURL(/\/organizer\/events\/[0-9a-f-]{36}$/);
  return page.getByLabel('Public registration link').inputValue();
}

/** A confirmed participant's management page, watched for requests and CSP violations. */
async function participantPage(page: Page, publicUrl: string, viewport = { width: 1280, height: 900 }) {
  const guest = address('guest');
  await registerParticipant(page.context().browser()!, publicUrl, guest);
  const [ticket] = await waitForMail(guest, 'Your ticket');
  const url = linkIn(ticket!, 'manage');
  const context = await page.context().browser()!.newContext({ viewport });
  const participant = await context.newPage();
  const requests: string[] = [];
  participant.on('request', (r) => requests.push(r.url()));
  const violations = await watchCsp(context);
  await participant.goto(url);
  return { participant, requests, violations, token: url.split('#t=')[1]!, context };
}

/** The marker is inside the map, at its centre (where the venue is), not clipped off-screen. */
async function expectMarkerCentred(participant: Page) {
  const map = (await participant.locator('.map-canvas').boundingBox())!;
  await expect
    .poll(async () => {
      const pin = (await participant.locator('.map-pin').boundingBox())!;
      const tipX = pin.x + pin.width / 2;
      const tipY = pin.y + pin.height;
      return (
        Math.abs(tipX - (map.x + map.width / 2)) <= 12 && Math.abs(tipY - (map.y + map.height / 2)) <= 14
      );
    })
    .toBe(true);
}

test('a confirmed participant sees the venue on a real map, served entirely from our origin', async ({
  page,
}) => {
  await signIn(page, address('organizer'));
  const publicUrl = await eventWithVenue(page, 'Map evening', ['40.177628', '44.512546']);
  const { participant, requests, violations, token, context } = await participantPage(page, publicUrl);

  const map = participant.getByRole('region', { name: 'Map of Riverside Hall' });
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute('data-latitude', '40.177628');
  await expect(map).toHaveAttribute('data-longitude', '44.512546');
  await expect(map.locator('img.leaflet-tile-loaded').first()).toBeVisible();
  await expect(map.getByRole('button', { name: 'Riverside Hall' })).toBeVisible(); // the marker
  await expectMarkerCentred(participant);
  const attribution = map.locator('.leaflet-control-attribution');
  await expect(attribution).toContainText('© OpenStreetMap contributors');
  await expect(attribution.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute(
    'href',
    'https://www.openstreetmap.org/copyright',
  );
  await expect(participant.getByRole('link', { name: 'Get directions' }).first()).toBeVisible();
  await expect(participant.getByRole('link', { name: 'Report a map issue' })).toBeVisible();

  const before = requests.length;
  await map.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => requests.slice(before).some((u) => u.includes('/map-tiles/'))).toBe(true);

  // Everything came from our origin; tiles carry the public event ID, never the link token.
  expect(requests.filter((u) => !u.startsWith(ORIGIN) && !u.startsWith('data:'))).toEqual([]);
  expect(requests.filter((u) => u.includes(token))).toEqual([]);
  const tiles = requests.filter((u) => u.includes('/map-tiles/'));
  expect(tiles.length).toBeGreaterThan(0);
  for (const u of tiles) expect(u).toMatch(/\/map-tiles\/[A-Za-z0-9_-]{22}\/1[2-8]\/\d+\/\d+\.png$/);
  expect(violations).toEqual([]);
  await context.close();
});

test('without coordinates the participant gets the address and directions, and failing tiles are explained', async ({
  page,
}) => {
  await signIn(page, address('organizer'));
  const noMap = await eventWithVenue(page, 'No pin', null);
  const first = await participantPage(page, noMap);
  await expect(
    first.participant.getByText('The organizer has not placed this venue on a map.'),
  ).toBeVisible();
  await expect(first.participant.locator('.leaflet-container')).toHaveCount(0);
  expect(first.requests.filter((u) => u.includes('/map-tiles/'))).toEqual([]);
  await first.context.close();

  // The stack's stand-in tile service fails in the southern hemisphere.
  const failing = await eventWithVenue(page, 'Far south', ['-45.031162', '168.662644']);
  const second = await participantPage(page, failing);
  await expect(second.participant.getByText('Some of the map could not be loaded.')).toBeVisible();
  await expect(second.participant.getByRole('link', { name: 'get directions', exact: true })).toBeVisible();
  expect(second.violations).toEqual([]);
  await second.context.close();
});

test('the map fits a 390 px phone screen', async ({ page }) => {
  await signIn(page, address('organizer'));
  const publicUrl = await eventWithVenue(page, 'Phone map', ['40.177628', '44.512546']);
  const { participant, violations, context } = await participantPage(page, publicUrl, {
    width: 390,
    height: 844,
  });
  const map = participant.getByRole('region', { name: 'Map of Riverside Hall' });
  await expect(map.locator('img.leaflet-tile-loaded').first()).toBeVisible();
  const box = (await map.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await map.scrollIntoViewIfNeeded();
  await expectMarkerCentred(participant);
  const overflow = await participant.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(violations).toEqual([]);
  await context.close();
});
