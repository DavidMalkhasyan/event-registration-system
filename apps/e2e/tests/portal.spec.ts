import { expect, test, type Browser, type Page } from '@playwright/test';
import { HOUR, address, createEvent, linkIn, registerParticipant, signIn, waitForMail } from './helpers.js';

// K-405 in the browser: FR-SELF-4, FR-SHR-1, FR-ROT-1 to FR-ROT-11, FR-LNK-10.

async function participantWithTicket(page: Page, browser: Browser) {
  await signIn(page, address('organizer'));
  const { publicUrl } = await createEvent(page, {
    title: `Portal ${Date.now()}`,
    capacity: 5,
    startsInMs: 72 * HOUR,
  });
  const guest = address('guest');
  const { ticketCode } = await registerParticipant(browser, publicUrl, guest);
  const [ticketMail] = await waitForMail(guest, 'Your ticket');
  return {
    guest,
    ticketCode: ticketCode!,
    manageUrl: linkIn(ticketMail!, 'manage'),
    shareUrl: linkIn(ticketMail!, 'ticket'),
  };
}

async function openFresh(browser: Browser, url: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  return { context, page };
}

test('participant resends the ticket, shares it, and replaces the share link without changing the ticket code', async ({
  page,
  browser,
}) => {
  const { guest, ticketCode, manageUrl, shareUrl } = await participantWithTicket(page, browser);
  const { context, page: manage } = await openFresh(browser, manageUrl);
  await expect(manage.getByText('Status: confirmed')).toBeVisible();

  await manage.getByRole('button', { name: 'Email me my ticket again' }).click();
  await expect(manage.getByText('We sent your ticket to your email address again.')).toBeVisible();
  const [resent] = await waitForMail(guest, 'Your ticket (resent)');
  expect(resent!.text).toContain(ticketCode);

  await manage.getByRole('button', { name: 'Share ticket' }).click();
  const issued = await manage.getByLabel('Share link (pass on only the ticket)').inputValue();
  const viewer = await openFresh(browser, issued);
  await expect(viewer.page.getByText(ticketCode)).toBeVisible();
  await viewer.context.close();

  await manage.getByRole('button', { name: 'Replace share link…' }).click();
  await expect(manage.getByText('The ticket code itself does not change')).toBeVisible();
  await manage.getByRole('button', { name: 'Yes, replace my share link' }).click();
  await expect(manage.getByText('Your share link was replaced.')).toBeVisible();
  const replacement = await manage.getByLabel('Your new share link').inputValue();

  for (const old of [shareUrl, issued]) {
    const stale = await openFresh(browser, old);
    await expect(stale.page.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
    await stale.context.close();
  }
  const fresh = await openFresh(browser, replacement);
  await expect(fresh.page.getByText(ticketCode)).toBeVisible(); // same ticket code (FR-ROT-2 c)
  await fresh.context.close();
  await expect(manage.getByText('Status: confirmed')).toBeVisible(); // the management link still works
  await context.close();
});

test('participant replaces the management link: the page keeps working with the new link, old links stop, and an email arrives', async ({
  page,
  browser,
}) => {
  const { guest, manageUrl } = await participantWithTicket(page, browser);
  const { context, page: manage } = await openFresh(browser, manageUrl);
  await expect(manage.getByText('Status: confirmed')).toBeVisible();
  expect(manage.url()).not.toContain('#'); // the token left the address bar (FR-LNK-10 b)

  await manage.getByRole('button', { name: 'Replace management link…' }).click();
  await expect(
    manage.getByText('All earlier management links, including the ones in earlier emails'),
  ).toBeVisible();
  await expect(manage.getByText('Your share links are not affected.')).toBeVisible();
  await manage.getByRole('button', { name: 'Yes, replace my management link' }).click();
  await expect(manage.getByText('This page now uses the new link')).toBeVisible();
  const newLink = await manage.getByLabel('Your new management link').inputValue();
  const newToken = newLink.split('#t=')[1]!;
  expect(manage.url()).not.toContain(newToken); // never put back into the address bar
  const storage = await manage.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain(newToken); // memory only

  // The page now acts with the new token.
  await manage.getByRole('button', { name: 'Email me my ticket again' }).click();
  await expect(manage.getByText('We sent your ticket to your email address again.')).toBeVisible();

  const stale = await openFresh(browser, manageUrl);
  await expect(stale.page.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
  await stale.context.close();

  const [replaced] = await waitForMail(guest, 'Your management link was replaced');
  const fromEmail = await openFresh(browser, linkIn(replaced!, 'manage'));
  await expect(fromEmail.page.getByText('Status: confirmed')).toBeVisible();
  await fromEmail.context.close();
  await context.close();
});
