import { crc32, deflateSync } from 'node:zlib';
import { expect, test } from './fixtures.js';
import { HOUR, address, createEvent, openSection, signIn, watchCsp } from './helpers.js';

// K-713 in the browser (PD-92): the organizer adds a cover and gallery photos, orders them, describes
// them and removes one; the public page shows the cover and a gallery with a keyboard-friendly viewer.
// Test images are generated here (no image files in the repository).

/** A solid-colour PNG, encoded by hand (zlib only). */
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
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const file = (name: string, buffer: Buffer, mimeType = 'image/png') => ({ name, mimeType, buffer });

test('an organizer publishes a cover and a gallery; visitors browse it with the keyboard', async ({
  page,
  browser,
}) => {
  const violations = await watchCsp(page.context());
  await signIn(page, address('organizer'));
  const { publicUrl } = await createEvent(page, {
    title: 'Harvest market',
    capacity: 30,
    startsInMs: 72 * HOUR,
  });
  await openSection(page, 'Photos');
  await expect(page.getByText('No cover yet: the event page shows its poster.')).toBeVisible();

  await page.getByLabel('Add a cover').setInputFiles(file('cover.png', png(1200, 800, [239, 121, 89])));
  await expect(page.getByText('1 photo added.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cover' })).toBeVisible();

  // Two real photos and an SVG dressed up as a PNG: the server refuses the disguise by its content.
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900"/></svg>',
  );
  await page
    .getByLabel('Add photos')
    .setInputFiles([
      file('stalls.png', png(900, 600, [93, 127, 95])),
      file('photo.png', svg),
      file('crowd.png', png(800, 800, [114, 97, 177])),
    ]);
  await expect(page.getByText('2 photos added.')).toBeVisible();
  await expect(page.getByText('photo.png is not a JPEG, PNG or WebP image.')).toBeVisible();
  await expect(page.getByText('2 of 8')).toBeVisible();

  await page.getByRole('button', { name: 'Move photo 2 earlier' }).click();
  await expect(page.getByText('Order saved.')).toBeVisible();
  await page.getByLabel('Description of photo 1').fill('A crowd under the plane trees');
  await page.getByLabel('Description of photo 1').press('Enter');
  await expect(page.getByText('Description saved.')).toBeVisible();

  // The public page: the cover in the hero, the gallery in the chosen order, a viewer for the keyboard.
  const visitor = await browser.newPage();
  const visitorViolations = await watchCsp(visitor.context());
  await visitor.goto(publicUrl);
  const hero = visitor.locator('.public-art img.event-photo');
  await expect(hero).toHaveAttribute('src', /^\/media\/images\/[0-9a-f]{32}\.webp$/);
  const gallery = visitor.getByRole('region', { name: 'Photos' });
  const first = gallery.getByRole('button', { name: 'Open photo 1 of 2: A crowd under the plane trees' });
  await first.click();
  const viewer = visitor.getByRole('dialog', { name: 'Photos of Harvest market' });
  await expect(viewer.getByText('1 of 2')).toBeVisible();
  await expect(viewer.getByRole('img', { name: 'A crowd under the plane trees' })).toBeVisible();
  await visitor.keyboard.press('ArrowRight');
  await expect(viewer.getByText('2 of 2')).toBeVisible();
  await visitor.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(first).toBeFocused();
  const served = await visitor.request.get(new URL((await hero.getAttribute('src'))!, publicUrl).toString());
  expect(served.headers()['content-type']).toBe('image/webp');

  // Removing a photo needs a confirmation and is visible at once.
  await page.getByRole('button', { name: 'Remove photo 2' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Photo removed.')).toBeVisible();
  await expect(page.getByText('1 of 8')).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByRole('region', { name: 'Photos' }).getByRole('button')).toHaveCount(1);
  await visitor.close();

  // The event list shows the cover instead of the poster.
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'All events' })
    .click();
  await expect(page.locator('.card-art-wrap img.event-photo')).toHaveCount(1);
  expect(violations).toEqual([]);
  expect(visitorViolations).toEqual([]);
});
