import { expect, test } from './fixtures.js';
import { seedOrganizer } from './db.js';
import { HOUR, address, createEvent, linkIn, waitForMail, watchCsp } from './helpers.js';

// K-716 in the browser (PD-94): an owner invites a second organizer, who creates an account with the
// invited address, confirms it, signs in and accepts; the owner makes them an admin; they leave again.

const PASSWORD = 'correct horse battery staple';

test('an owner invites an organizer who joins, works on the shared events, changes role and leaves', async ({
  page,
  browser,
}) => {
  const violations = await watchCsp(page.context());
  const owner = address('owner');
  await seedOrganizer(owner, PASSWORD);
  await page.goto('/organizer');
  await page.getByLabel('Email address').fill(owner);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await createEvent(page, { title: 'Shared concert', capacity: 10, startsInMs: 72 * HOUR });

  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Organization' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: owner })).toBeVisible();
  const grace = address('grace');
  await page.getByLabel('Email address').fill(grace);
  await page.getByLabel('Role', { exact: true }).selectOption('member');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`Invitation email queued for ${grace}.`)).toBeVisible();
  await expect(page.getByText(`${grace} · Member`)).toBeVisible();

  const [invitation] = await waitForMail(grace, 'You are invited to join');
  expect(invitation!.text).toContain('/organizer/join');
  expect(invitation!.text).not.toContain('#t='); // the email grants nothing by itself

  // The invitee creates an account with the invited address, confirms it and signs in.
  const context = await browser.newContext();
  const other = await context.newPage();
  const otherViolations = await watchCsp(context);
  await other.goto('/organizer');
  await other.getByRole('link', { name: 'Invited to an organization? Create your account' }).click();
  await other.getByLabel('Your name').fill('Grace Hopper');
  await other.getByLabel('Email address').fill(grace);
  await other.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await other.getByLabel('Confirm password').fill(PASSWORD);
  await other.getByRole('button', { name: 'Create account' }).click();
  await expect(other.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const [confirmMail] = await waitForMail(grace, 'Confirm your email address');
  await other.goto(linkIn(confirmMail!, 'verify-account'));
  await other.getByRole('button', { name: 'Confirm my email address' }).click();
  await expect(
    other.getByText('Your organizer account is ready. Sign in to accept your invitation.'),
  ).toBeVisible();
  await other.goto('/organizer');
  await other.getByLabel('Email address').fill(grace);
  await other.getByLabel('Password').fill(PASSWORD);
  await other.getByRole('button', { name: 'Sign in' }).click();
  const invitations = other.getByRole('region', { name: 'Invitations' });
  await expect(invitations.getByText(`invited you to join ${owner} as member`)).toBeVisible();
  await invitations.getByRole('button', { name: 'Accept' }).click();
  await expect(other.getByRole('heading', { level: 1, name: 'Good things happen together.' })).toBeVisible();
  await other
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'All events' })
    .click();
  await expect(other.getByRole('main').getByRole('link', { name: /^Shared concert/ })).toBeVisible();

  // The owner makes them an admin.
  await page.reload();
  await page.getByLabel('Role of Grace Hopper').selectOption('admin');
  await expect(page.getByText('Grace Hopper is now admin.')).toBeVisible();

  // They leave; their access ends at once.
  await other
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Organization' })
    .click();
  await other.getByRole('button', { name: 'Leave' }).click();
  await other.getByRole('dialog').getByRole('button', { name: 'Leave' }).click();
  await expect(other.getByRole('heading', { name: 'No organization' })).toBeVisible();
  await context.close();
  await page.reload();
  await expect(page.getByText('Grace Hopper')).toHaveCount(0);
  expect(violations).toEqual([]);
  expect(otherViolations).toEqual([]);
});
