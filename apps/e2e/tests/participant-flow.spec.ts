import { expect, test } from './fixtures.js';
import {
  HOUR,
  REGISTER_BUTTON,
  address,
  createEvent,
  linkIn,
  mailFor,
  openSection,
  openVerification,
  readResult,
  registerParticipant,
  signIn,
  stat,
  waitForMail,
} from './helpers.js';

// P0 #1–#8 and #11 through the real UI: organizer and participants each use their own browser context.
test('organizer creates an event; participants register, join the waiting list, cancel and get promoted', async ({
  page,
  browser,
}) => {
  const organizer = address('organizer');
  const anna = address('anna');
  const ben = address('ben');
  const title = `Workshop ${Date.now()}`;

  await signIn(page, organizer);
  const { publicUrl } = await createEvent(page, { title, capacity: 1, startsInMs: 72 * HOUR });
  // Description shown on the event's overview section.
  await expect(page.locator('p', { hasText: 'Created by the end-to-end test.' })).toBeVisible();

  // Anna takes the only seat and sees her ticket.
  const annaResult = await registerParticipant(browser, publicUrl, anna);
  expect(annaResult.result).toBe('confirmed');
  expect(annaResult.ticketCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
  const [ticketMail] = await waitForMail(anna, 'Your ticket');
  expect(ticketMail!.text).toContain(annaResult.ticketCode!);

  // Ben joins the waiting list.
  const benResult = await registerParticipant(browser, publicUrl, ben);
  expect(benResult.result).toBe('waitlisted');
  await waitForMail(ben, 'You are on the waiting list');

  // Anna registers again with the same address: same neutral response, no second seat (P0 #4).
  const again = await browser.newContext();
  const againPage = await again.newPage();
  await againPage.goto(publicUrl);
  await againPage.getByLabel('Email address').fill(anna.toUpperCase());
  await againPage.getByRole('button', REGISTER_BUTTON).click();
  await expect(againPage.getByText('Check your email.')).toBeVisible();
  await waitForMail(anna, 'Your registration');
  await again.close();

  await page.reload();
  await expect(stat(page, 'Confirmed')).toHaveText('1');
  await expect(stat(page, 'Waiting list')).toHaveText('1');

  // Anna cancels through the management link from her ticket email (P0 #3).
  const annaContext = await browser.newContext();
  const annaPage = await annaContext.newPage();
  await annaPage.goto(linkIn(ticketMail!, 'manage'));
  await expect(annaPage.getByText('Status: confirmed')).toBeVisible();
  await annaPage.getByRole('button', { name: 'Cancel my registration…' }).click();
  await annaPage.getByRole('button', { name: 'Yes, cancel my registration' }).click();
  await expect(annaPage.getByRole('heading', { name: 'Registration cancelled' })).toBeVisible();
  await annaContext.close();

  // Ben is promoted automatically and receives his ticket by email (P0 #6, #8).
  const [promotion] = await waitForMail(ben, 'A place became free');
  expect(promotion!.text).toMatch(/[0-9A-HJKMNP-TV-Z]{12}/);
  await waitForMail(anna, 'Registration cancelled');

  await page.reload();
  await expect(stat(page, 'Confirmed')).toHaveText('1');
  await expect(stat(page, 'Waiting list')).toHaveText('0');
  await openSection(page, 'Participants');
  const benRow = page.getByRole('row', { name: new RegExp(ben.replace(/[.+]/g, '\\$&')) });
  await expect(benRow).toContainText('Confirmed');
  expect(mailFor(anna, 'Your ticket')).toHaveLength(1); // no duplicate ticket emails
});

test('a verification link that was already used shows the result instead of a second seat', async ({
  page,
  browser,
}) => {
  const organizer = address('organizer');
  const carla = address('carla');
  await signIn(page, organizer);
  const { publicUrl } = await createEvent(page, {
    title: `Talk ${Date.now()}`,
    capacity: 3,
    startsInMs: 72 * HOUR,
  });
  const participant = await (await browser.newContext()).newPage();
  await openVerification(participant, publicUrl, carla);
  const verifyUrl = linkIn(mailFor(carla, 'Confirm your registration')[0]!, 'verify'); // the page strips the fragment
  await participant.getByRole('button', { name: 'Confirm my registration' }).click();
  expect((await readResult(participant)).result).toBe('confirmed');

  await participant.goto('about:blank');
  await participant.goto(verifyUrl);
  await expect(participant.getByRole('heading', { name: 'Already confirmed' })).toBeVisible();
  await page.reload();
  await expect(stat(page, 'Confirmed')).toHaveText('1');
});
