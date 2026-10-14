import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type Page } from './fixtures.js';
import { ORIGIN, REPO_ROOT } from './env.js';
import { address, linkIn, waitForMail, watchCsp } from './helpers.js';

// K-710 in the browser (PD-90): the operator command creates a Super Admin (never the web); the Super
// Admin signs in at /admin, approves one registration and rejects another with a reason; the approved
// organizer can then work, the rejected one cannot.

const PASSWORD = 'correct horse battery staple';
const ADMIN_PASSWORD = 'a long admin passphrase';

/** `pnpm admin:create` as an operator runs it, against the test database, password on standard input. */
function createAdmin(email: string) {
  if (!process.env.TEST_MIGRATION_DATABASE_URL) process.loadEnvFile(resolve(REPO_ROOT, '.env'));
  const run = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/entrypoints/admin.ts', 'create', '--email', email, '--name', 'Grace Hopper'],
    {
      cwd: resolve(REPO_ROOT, 'apps/server'),
      env: { ...process.env, MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL },
      input: `${ADMIN_PASSWORD}\n`,
      encoding: 'utf8',
    },
  );
  expect(run.stderr).toBe('');
  expect(run.stdout).toContain(`Super Admin ${email} created`);
  expect(run.stdout).not.toContain(ADMIN_PASSWORD);
  return run;
}

/** An organization registered and confirmed through the product: it waits for approval. */
async function registeredOrganization(page: Page, email: string, name: string) {
  const r = await page.request.post('/api/organizations/registrations', {
    headers: { origin: ORIGIN },
    data: { organizationName: name, contactName: 'Ada Lovelace', email, password: PASSWORD },
  });
  expect(r.status()).toBe(202);
  const [mail] = await waitForMail(email, 'Confirm your email address');
  await page.goto('about:blank'); // a link that differs only in its #fragment would not reload the page
  await page.goto(linkIn(mail!, 'verify-account'));
  await page.getByRole('button', { name: 'Confirm my email address' }).click();
  await expect(page.getByRole('heading', { name: 'Email address confirmed' })).toBeVisible();
}

async function organizerSignIn(page: Page, email: string) {
  await page.goto('/organizer');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('a Super Admin created by the operator command approves one organization and rejects another', async ({
  page,
  browser,
}) => {
  const violations = await watchCsp(page.context());
  const admin = address('super');
  createAdmin(admin);
  // The same command refuses to touch an existing Super Admin.
  const again = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/entrypoints/admin.ts', 'create', '--email', admin, '--name', 'Someone'],
    {
      cwd: resolve(REPO_ROOT, 'apps/server'),
      env: { ...process.env, MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL },
      input: 'another long password\n',
      encoding: 'utf8',
    },
  );
  expect(again.status).toBe(1);
  expect(again.stderr).toContain('already a Super Admin; nothing was changed');

  const good = address('riverside');
  const bad = address('spam');
  await registeredOrganization(page, good, 'Riverside Arts');
  await registeredOrganization(page, bad, 'Totally Real Events');

  // The admin area is its own entry; organizer credentials are not admin credentials.
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const adminViolations = await watchCsp(adminContext);
  await adminPage.goto('/admin');
  await expect(adminPage.getByRole('heading', { name: 'Super Admin sign-in' })).toBeVisible();
  await adminPage.getByLabel('Email address').fill(good);
  await adminPage.getByLabel('Password').fill(PASSWORD);
  await adminPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    adminPage.getByText('The email address, password or authentication code is not correct.'),
  ).toBeVisible();
  await adminPage.getByLabel('Email address').fill(admin);
  await adminPage.getByLabel('Password').fill(ADMIN_PASSWORD);
  await adminPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(adminPage.getByRole('heading', { level: 1, name: 'Organizations' })).toBeVisible();
  await expect(adminPage.getByRole('button', { name: /Awaiting approval/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const riverside = adminPage.getByRole('article', { name: 'Riverside Arts' });
  await expect(riverside.getByText(`Ada Lovelace · ${good}`)).toBeVisible();
  await riverside.getByRole('button', { name: 'Approve' }).click();
  const dialog = adminPage.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Approve this organization?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Approve' }).click();
  await expect(adminPage.getByText('Riverside Arts: approved. The owners are being emailed.')).toBeVisible();
  await expect(riverside).toHaveCount(0); // no longer awaiting approval

  const spam = adminPage.getByRole('article', { name: 'Totally Real Events' });
  await spam.getByRole('button', { name: 'Reject' }).click();
  await dialog.getByRole('button', { name: 'Reject' }).click();
  await expect(dialog.getByText('Give a reason; it is sent to the owners.')).toBeVisible();
  await dialog.getByLabel('Reason (sent to the owners)').fill('We could not verify this organization.');
  await dialog.getByRole('button', { name: 'Reject' }).click();
  await expect(adminPage.getByText('Totally Real Events: rejected.', { exact: false })).toBeVisible();

  await adminPage.getByRole('button', { name: /^Rejected/ }).click();
  await spam.getByRole('button', { name: 'Show history' }).click();
  const history = spam.getByRole('list', { name: 'History' });
  await expect(history.getByText('Rejected')).toBeVisible();
  await expect(history.getByText('by Grace Hopper')).toBeVisible();
  await expect(history.getByText('Reason: We could not verify this organization.')).toBeVisible();

  // The owners hear about it.
  const [approvedMail] = await waitForMail(good, 'Your organization was approved');
  expect(approvedMail!.text).toContain('"Riverside Arts" is approved');
  const [rejectedMail] = await waitForMail(bad, 'Your organization was not approved');
  expect(rejectedMail!.text).toContain('Reason given: We could not verify this organization.');

  // The approved organizer works; the rejected one sees its state.
  await organizerSignIn(page, good);
  await expect(page.getByRole('heading', { level: 1, name: 'Good things happen together.' })).toBeVisible();
  await expect(page.getByText('Riverside Arts · Owner')).toBeVisible();
  await page.context().clearCookies();
  await organizerSignIn(page, bad);
  await expect(page.getByRole('heading', { name: 'Registration not approved' })).toBeVisible();

  await adminPage.getByRole('button', { name: 'Sign out' }).click();
  await expect(adminPage.getByRole('heading', { name: 'Super Admin sign-in' })).toBeVisible();
  await adminContext.close();
  expect(violations).toEqual([]);
  expect(adminViolations).toEqual([]);
});
