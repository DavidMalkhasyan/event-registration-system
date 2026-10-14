import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from './fixtures.js';
import { ORIGIN } from './env.js';
import { HOUR, address, mailFor, registerParticipant, signIn, waitForMail } from './helpers.js';

// K-702 in the browser: the date field starts with the event's current start in the event's own time
// zone (not the browser's, Europe/Berlin in playwright.config.ts); an unchanged value can't be saved;
// a change is confirmed first and emails participants; Settings shows one prominent destructive action.

const ZONE = 'Asia/Tokyo';

/** "YYYY-MM-DDTHH:mm" in ZONE, `ms` from now, rounded down to a whole hour. */
function tokyoIn(ms: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(Date.now() + ms))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00`;
}

async function createTokyoEvent(page: Page, title: string, localStart: string) {
  const { csrfToken } = (await (await page.request.get('/api/auth/session')).json()) as { csrfToken: string };
  const response = await page.request.post('/api/events', {
    headers: { origin: ORIGIN, 'x-csrf-token': csrfToken },
    data: {
      requestId: randomUUID(),
      title,
      description: 'Settings test',
      localStart,
      timeZone: ZONE,
      capacity: 5,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).event as { id: string; publicUrl: string };
}

test('the date is prefilled in the event time zone; unchanged dates send nothing; a change is confirmed and emailed', async ({
  page,
  browser,
}) => {
  await signIn(page, address('organizer'));
  const title = `Tokyo ${Date.now()}`;
  const start = tokyoIn(96 * HOUR);
  const event = await createTokyoEvent(page, title, start);
  const guest = address('guest');
  expect((await registerParticipant(browser, event.publicUrl, guest)).result).toBe('confirmed');

  await page.goto(`/organizer/events/${event.id}/settings`);
  const field = page.getByLabel(`Start date and time (${ZONE})`);
  await expect(field).toHaveValue(start); // the event's local time, not the browser's
  const save = page.getByRole('button', { name: 'Save new date' });
  await expect(save).toBeDisabled();

  // Editing back to the same value leaves nothing to save.
  await field.fill(tokyoIn(120 * HOUR));
  await expect(save).toBeEnabled();
  await field.fill(start);
  await expect(save).toBeDisabled();

  // A real change asks first and names who is emailed; "Keep the current date" changes nothing.
  const moved = tokyoIn(120 * HOUR);
  await field.fill(moved);
  await save.click();
  const dialog = page.getByRole('dialog', { name: 'Change the date and time?' });
  await expect(dialog).toContainText('A change email is queued for 1 participant');
  await dialog.getByRole('button', { name: 'Keep the current date' }).click();
  await expect(dialog).toHaveCount(0);
  expect(mailFor(guest, 'Date changed')).toHaveLength(0);

  await save.click();
  await dialog.getByRole('button', { name: 'Yes, reschedule and notify' }).click();
  await expect(
    page.getByText(/^Rescheduled to .*Change emails are queued for 1 participant\.$/),
  ).toBeVisible();
  await expect(field).toHaveValue(moved); // not cleared, and now the saved value
  await expect(save).toBeDisabled();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await waitForMail(guest, 'Date changed');
  expect(mailFor(guest, 'Date changed')).toHaveLength(1);
});

test('Settings shows one prominent Cancel event action, deletion only under More actions, and keeps unsaved edits', async ({
  page,
}) => {
  await signIn(page, address('organizer'));
  const event = await createTokyoEvent(page, `Simple ${Date.now()}`, tokyoIn(96 * HOUR));
  await page.goto(`/organizer/events/${event.id}/settings`);

  await expect(page.getByRole('heading', { name: 'Recent sign-in' })).toHaveCount(0);
  await expect(page.getByText('Careful changes')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /cancel/i, exact: false })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Cancel event' })).toBeVisible();
  // Deletion is a different operation, collapsed under More actions.
  await expect(page.getByRole('button', { name: 'Delete this event…' })).toBeHidden();
  await page.locator('summary', { hasText: 'More actions' }).click();
  await expect(page.getByRole('button', { name: 'Delete this event…' })).toBeVisible();

  // The cancellation dialog names the event and says what happens, then backs out without a change.
  await page.getByRole('button', { name: 'Cancel event' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('will be cancelled permanently');
  await expect(dialog).toContainText('A cancellation email is queued for nobody');
  await expect(dialog).toContainText('Every ticket stops being valid');
  await dialog.getByRole('button', { name: 'Keep the event' }).click();

  // An unsaved title survives a reload of the workspace caused by another save.
  const titleField = page.getByLabel('Event title');
  await titleField.fill('A title I have not saved yet');
  await page.getByLabel('Number of seats').fill('9');
  await page.getByRole('button', { name: 'Update capacity' }).click();
  await expect(page.getByText('Capacity is now 9.')).toBeVisible();
  await expect(page.getByLabel('Number of seats')).toHaveValue('9');
  await expect(titleField).toHaveValue('A title I have not saved yet');
  await expect(page.getByRole('button', { name: 'Save details' })).toBeEnabled();
});
