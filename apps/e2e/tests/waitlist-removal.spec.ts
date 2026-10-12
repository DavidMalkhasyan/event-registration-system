import { expect, test } from '@playwright/test';
import {
  HOUR,
  address,
  createEvent,
  linkIn,
  openSection,
  registerParticipant,
  signIn,
  stat,
  waitForMail,
} from './helpers.js';

// K-305b in the browser: FR-WL-10, FR-WL-11, FR-WL-13, FR-NTF-14, AC-76.
test('owner removes the second of three waiting entries after confirming; the rest move up and the removed participant is emailed', async ({
  page,
  browser,
}) => {
  await signIn(page, address('organizer'));
  const { publicUrl } = await createEvent(page, {
    title: `Waiting ${Date.now()}`,
    capacity: 1,
    startsInMs: 72 * HOUR,
  });
  expect((await registerParticipant(browser, publicUrl, address('first'))).result).toBe('confirmed');
  const waiting = [address('w1'), address('w2'), address('w3')];
  for (const email of waiting)
    expect((await registerParticipant(browser, publicUrl, email)).result).toBe('waitlisted');
  const [waitlistMail] = await waitForMail(waiting[1]!, 'You are on the waiting list');
  const manageUrl = linkIn(waitlistMail!, 'manage');

  await page.reload();
  await expect(stat(page, 'Waiting list')).toHaveText('3');
  await openSection(page, 'Waiting list');
  const row = page.getByRole('row', { name: new RegExp(waiting[1]!) });
  await expect(row.getByText('Position #2')).toBeVisible();
  // Asking, then keeping the entry, changes nothing.
  await row.getByRole('button', { name: 'Remove from waiting list' }).click();
  await row.getByRole('button', { name: 'Keep on the list' }).click();
  await expect(stat(page, 'Waiting list')).toHaveText('3');

  await row.getByRole('button', { name: 'Remove from waiting list' }).click();
  await expect(row.getByText(/Nobody is promoted/)).toBeVisible();
  await row.getByLabel(/Reason/).fill('Registered twice');
  await row.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(
    page.getByText(`${waiting[1]} was removed from the waiting list and has been emailed.`),
  ).toBeVisible();
  await expect(stat(page, 'Waiting list')).toHaveText('2');
  await expect(stat(page, 'Confirmed')).toHaveText('1');
  // The waiting list shows only those still waiting; the full list shows the removal.
  await expect(row).toHaveCount(0);
  await openSection(page, 'Participants');
  await expect(row.getByText('Cancelled')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Remove from waiting list' })).toHaveCount(0);
  await expect(
    page.getByRole('row', { name: new RegExp(waiting[2]!) }).getByText('Position #2'),
  ).toBeVisible();

  const [notice] = await waitForMail(waiting[1]!, 'Removed from the waiting list');
  expect(notice!.text).toContain('has removed you from the waiting list');
  expect(notice!.text).not.toMatch(/\/manage|\/ticket|#t=|Registered twice/);

  // The removed participant's management link no longer works.
  const participant = await (await browser.newContext()).newPage();
  await participant.goto(manageUrl);
  await expect(participant.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
});
