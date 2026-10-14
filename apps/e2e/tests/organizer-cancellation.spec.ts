import { expect, test } from './fixtures.js';
import {
  HOUR,
  address,
  checkInResult,
  createEvent,
  linkIn,
  localIn,
  openSection,
  registerParticipant,
  reschedule,
  signIn,
  stat,
  waitForMail,
} from './helpers.js';

// K-703 in the browser (PD-83): the owner cancels one confirmed registration from Participants; the
// participant is emailed, the first waiting person is promoted, the page updates in place, and the
// public page shows the resulting availability at its next refresh. Checked-in people can't be cancelled.

test('owner cancels one confirmed registration: notice, FIFO promotion, in-place update and public availability', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  await signIn(page, address('organizer'));
  const { publicUrl } = await createEvent(page, {
    title: `Organizer cancel ${Date.now()}`,
    capacity: 2,
    startsInMs: 72 * HOUR,
  });
  const anna = address('anna');
  const ben = address('ben');
  const wait = address('wait');
  expect((await registerParticipant(browser, publicUrl, anna)).result).toBe('confirmed');
  const { ticketCode: benCode } = await registerParticipant(browser, publicUrl, ben);
  expect((await registerParticipant(browser, publicUrl, wait)).result).toBe('waitlisted');
  const [annaTicket] = await waitForMail(anna, 'Your ticket');

  // A visitor keeps the public page open: full, one person waiting.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.clock.install();
  await visitor.goto(publicUrl);
  const badge = visitor.getByRole('region', { name: 'Availability' }).locator('.status');
  await expect(badge).toHaveText('Waiting list available');
  await expect(visitor.getByText('1 person waiting')).toBeVisible();

  let loads = 0;
  page.on('load', () => (loads += 1));
  await page.reload();
  loads = 0;
  await openSection(page, 'Participants');
  const annaRow = page.getByRole('row', { name: new RegExp(anna) });
  await annaRow.getByRole('button', { name: 'Cancel registration' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel this registration?' });
  await expect(dialog).toContainText(anna);
  await expect(dialog).toContainText('The seat goes to the first person on the waiting list (1 waiting)');
  await dialog.getByRole('button', { name: 'Yes, cancel registration' }).click();

  await expect(
    page.getByText(`The registration of ${anna} was cancelled; a cancellation email to them is queued.`),
  ).toBeVisible();
  // In place, without a page load: Anna stays listed as cancelled by you; the waiting person is confirmed.
  await expect(annaRow).toContainText('Cancelled');
  await expect(annaRow).toContainText('by you');
  await expect(annaRow.getByRole('button', { name: 'Cancel registration' })).toHaveCount(0);
  await expect(page.getByRole('row', { name: new RegExp(wait) })).toContainText('Confirmed');
  await expect(stat(page, 'Confirmed')).toHaveText('2');
  await expect(stat(page, 'Waiting list')).toHaveText('0');
  expect(loads).toBe(0);

  const [notice] = await waitForMail(anna, 'Registration cancelled by the organizer');
  expect(notice!.text).toContain('has been cancelled by the organizer');
  expect(notice!.text).not.toMatch(/#t=/);
  await waitForMail(wait, 'A place became free');
  // Anna's links no longer work.
  const old = await browser.newContext();
  const manage = await old.newPage();
  await manage.goto(linkIn(annaTicket!, 'manage'));
  await expect(manage.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
  await old.close();

  // The open public page shows the authoritative result at its next refresh: still full, nobody waiting.
  await visitor.clock.fastForward(16_000);
  await expect(badge).toHaveText('Waiting list available');
  await expect(visitor.getByText('No one is waiting yet')).toBeVisible();
  await visitorContext.close();

  // A checked-in participant can't be cancelled; the row explains why.
  await openSection(page, 'Settings');
  await reschedule(page, localIn(1 * HOUR));
  await openSection(page, 'Check-in');
  await page.getByLabel('Ticket code').fill(benCode!);
  await page.getByRole('button', { name: 'Check in' }).click();
  await expect(checkInResult(page)).toHaveText('Checked in');
  await openSection(page, 'Participants');
  const benRow = page.getByRole('row', { name: new RegExp(ben) });
  await expect(benRow).toContainText('Checked in, so the registration can’t be cancelled');
  await expect(benRow.getByRole('button', { name: 'Cancel registration' })).toHaveCount(0);
  await expect(benRow.getByRole('button', { name: 'Undo check-in' })).toBeVisible();
});
