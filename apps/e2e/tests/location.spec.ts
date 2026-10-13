import { expect, test } from './fixtures.js';
import {
  HOUR,
  address,
  linkIn,
  localIn,
  openSection,
  registerParticipant,
  signIn,
  waitForMail,
  watchCsp,
} from './helpers.js';

// K-711 in the browser (PD-91): the organizer gives the venue at creation, participants see it with
// directions, and a change of the venue is confirmed by the organizer and emailed to participants.

test('the venue appears with directions on the public and ticket pages, and a change is emailed', async ({
  page,
  browser,
}) => {
  const violations = await watchCsp(page.context());
  await signIn(page, address('organizer'));
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Create event' })
    .click();
  const [date, time] = localIn(72 * HOUR).split('T');
  await page.getByLabel('Event title').fill('Courtyard concert');
  await page.getByLabel('Date', { exact: true }).fill(date!);
  await page.getByLabel('Start time').fill(time!);
  await page.getByLabel('Capacity').fill('20');
  await page.getByLabel('Venue name').fill('Riverside Hall');
  await page.getByLabel('Street address').fill('12 Mill Lane');
  // Incomplete: the form says what is missing and sends nothing.
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(
    page.getByText('A location needs the venue name, street address, city and country.'),
  ).toBeVisible();
  await page.getByLabel('City', { exact: true }).fill('Yerevan');
  await page.getByLabel('Country').fill('Armenia');
  await page.getByLabel('Arrival instructions (optional)').fill('Side entrance after 18:00.');
  await page.getByRole('button', { name: 'Create event' }).click();
  await page.waitForURL(/\/organizer\/events\/[0-9a-f-]{36}$/);
  const publicUrl = await page.getByLabel('Public registration link').inputValue();

  // The public page: venue, address and directions that open elsewhere, without any token.
  const visitor = await browser.newPage();
  const visitorViolations = await watchCsp(visitor.context());
  await visitor.goto(publicUrl);
  const venue = visitor.getByRole('region', { name: 'Location' });
  await expect(venue.getByText('Riverside Hall')).toBeVisible();
  await expect(venue.getByText('Side entrance after 18:00.')).toBeVisible();
  const directions = venue.getByRole('link', { name: 'Get directions' });
  await expect(directions).toHaveAttribute('target', '_blank');
  await expect(directions).toHaveAttribute('rel', 'noopener noreferrer');
  const href = (await directions.getAttribute('href'))!;
  expect(href.startsWith('https://www.google.com/maps/dir/?api=1&destination=')).toBe(true);
  expect(decodeURIComponent(href)).toContain('Riverside Hall, 12 Mill Lane, Yerevan, Armenia');
  await visitor.close();

  const anna = address('anna');
  expect((await registerParticipant(browser, publicUrl, anna)).result).toBe('confirmed');
  const [ticketMail] = await waitForMail(anna, 'Your ticket');

  // A change of the venue is confirmed first, because participants are emailed.
  await page.reload(); // the counts in the dialog are those of the last refresh
  await openSection(page, 'Settings');
  await page.getByLabel('Venue name').fill('Garden Pavilion');
  await page.getByRole('button', { name: 'Save location' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('A venue-change email will be queued for 1 participant')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save and notify' }).click();
  await expect(
    page.getByText('Location saved. Venue-change emails are queued for 1 participant.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save location' })).toBeDisabled();

  const [venueMail] = await waitForMail(anna, 'Venue changed');
  expect(venueMail!.text).toContain('New venue: Garden Pavilion, 12 Mill Lane, Yerevan, Armenia.');

  // The participant's management page shows where to go now; its directions carry no link token.
  const participant = await browser.newPage();
  const participantViolations = await watchCsp(participant.context());
  const manageUrl = linkIn(ticketMail!, 'manage');
  await participant.goto(manageUrl);
  const where = participant.getByRole('region', { name: 'Where to go' });
  await expect(where.getByText('Garden Pavilion')).toBeVisible();
  const token = manageUrl.split('#t=')[1]!;
  for (const link of await where.getByRole('link').all())
    expect(await link.getAttribute('href')).not.toContain(token);
  await participant.close();

  expect(violations).toEqual([]);
  expect(visitorViolations).toEqual([]);
  expect(participantViolations).toEqual([]);
});
