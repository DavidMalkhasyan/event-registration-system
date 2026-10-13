import { expect, test } from './fixtures.js';
import { seedOrganizer, setOrganizationStatus } from './db.js';
import { address, linkIn, waitForMail, watchCsp } from './helpers.js';

// K-709 in the browser (PD-89): organization registration, email verification, password sign-in,
// the approval state, and password reset. Participants are not involved: they never have accounts.

const PASSWORD = 'correct horse battery staple';

test('an organization registers, confirms its address, waits for approval, then manages events', async ({
  page,
}) => {
  const violations = await watchCsp(page.context());
  const email = address('founder');
  await page.goto('/organizer');
  await expect(page.getByRole('heading', { name: 'Organizer sign-in' })).toBeVisible();
  await page.getByRole('link', { name: 'Register your organization' }).click();
  await page.getByLabel('Organization name').fill('Riverside Arts');
  await page.getByLabel('Contact person').fill('Ada Lovelace');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill('something else entirely');
  await expect(page.getByText('The two passwords are not the same.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Register' })).toBeDisabled();
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  // Before confirming the address, the right password only learns that it must be confirmed.
  await page.goto('/organizer');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Confirm your email address first')).toBeVisible();

  const [mail] = await waitForMail(email, 'Confirm your email address');
  await page.goto(linkIn(mail!, 'verify-account'));
  await expect(page.getByRole('heading', { name: 'Confirm your email address' })).toBeVisible();
  await expect(page.getByText('Riverside Arts')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm my email address' }).click();
  await expect(page.getByRole('heading', { name: 'Email address confirmed' })).toBeVisible();

  await page.goto('/organizer');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Awaiting approval' })).toBeVisible();
  await expect(page.getByText('Riverside Arts')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create event' })).toHaveCount(0);

  // The Super Admin's approval (K-710) is stood in for by the test database here.
  expect(await setOrganizationStatus(email, 'active')).toBe(1);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Good things happen together.' })).toBeVisible();
  await expect(page.getByText('Riverside Arts · Owner')).toBeVisible();
  expect(violations).toEqual([]);
});

test('a wrong password and an unknown address get the same answer; a reset signs out every device', async ({
  page,
  browser,
}) => {
  const violations = await watchCsp(page.context());
  const email = address('organizer');
  await seedOrganizer(email, PASSWORD);
  const signIn = async (p: typeof page, who: string, password: string) => {
    await p.goto('/organizer');
    await p.getByLabel('Email address').fill(who);
    await p.getByLabel('Password').fill(password);
    await p.getByRole('button', { name: 'Sign in' }).click();
  };
  await signIn(page, email, 'not the password');
  await expect(page.getByText('The email address or password is not correct.')).toBeVisible();
  await signIn(page, address('nobody'), PASSWORD);
  await expect(page.getByText('The email address or password is not correct.')).toBeVisible();

  // Another device is signed in.
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signIn(other, email, PASSWORD);
  await expect(other.getByRole('heading', { level: 1, name: 'Good things happen together.' })).toBeVisible();

  await page.goto('/organizer');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByText('we sent it a link to set a new password')).toBeVisible();
  const [mail] = await waitForMail(email, 'Set a new password');
  await page.goto(linkIn(mail!, 'reset-password'));
  await page.getByLabel('New password', { exact: true }).fill('a brand new password');
  await page.getByLabel('Confirm new password').fill('a brand new password');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();

  await other.reload();
  await expect(other.getByRole('heading', { name: 'Organizer sign-in' })).toBeVisible(); // signed out
  await otherContext.close();
  await signIn(page, email, PASSWORD);
  await expect(page.getByText('The email address or password is not correct.')).toBeVisible();
  await signIn(page, email, 'a brand new password');
  await expect(page.getByRole('heading', { level: 1, name: 'Good things happen together.' })).toBeVisible();
  expect(violations).toEqual([]);
});
