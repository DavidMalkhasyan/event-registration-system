import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL,
  ORGANIZER_EMAIL,
  SeedError,
  assertLocal,
  ensureDemoAdmin,
  ensureDemoOrganizer,
} from '../src/demo/accounts.js';
import { enrolTotp } from '../src/modules/platform-admin/bootstrap.js';
import { newTotpSecret, stepAt, totpCode } from '../src/platform/totp.js';
import { ORIGIN, createHarness, resetData, type Harness } from './harness.js';

// The local demo accounts (`pnpm seed:demo`): both authenticate with the generated or chosen password,
// seeding twice changes nothing, and the Super Admin's second factor is onboarded with the production
// operator path (enrolTotp, the core of `pnpm admin:totp`) and then enforced on sign-in.

const TOTP_KEY = randomBytes(32).toString('base64');
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ ADMIN_TOTP_KEY: TOTP_KEY, ADMIN_REQUIRE_TOTP: 'true' });
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h));

const organizerSignIn = (password: string) =>
  h.app.inject({
    method: 'POST',
    url: '/api/auth/password-sessions',
    headers: { origin: ORIGIN },
    payload: { email: ORGANIZER_EMAIL, password },
  });
const adminSignIn = (password: string, code?: string) =>
  h.app.inject({
    method: 'POST',
    url: '/api/admin/sessions',
    headers: { origin: ORIGIN },
    payload: { email: ADMIN_EMAIL, password, ...(code ? { code } : {}) },
  });

describe('demo organizer', () => {
  it('signs in with the generated password, and a second seed changes nothing', async () => {
    const first = await ensureDemoOrganizer(h.owner);
    expect(first.password).toMatch(/^[A-Za-z0-9_-]{20}$/);
    expect((await organizerSignIn(first.password!)).statusCode).toBe(200);
    expect((await organizerSignIn('not the password at all')).statusCode).toBe(401);
    const second = await ensureDemoOrganizer(h.owner);
    expect(second).toEqual({
      accountId: first.accountId,
      organizationId: first.organizationId,
      password: null,
    });
    expect((await organizerSignIn(first.password!)).statusCode).toBe(200);
    const orgs = await h.db.selectFrom('app.organizations').select('id').execute();
    expect(orgs).toHaveLength(1);
  });

  it('uses a chosen password without reporting it', async () => {
    const chosen = 'a password I chose myself';
    expect((await ensureDemoOrganizer(h.owner, chosen)).password).toBeNull();
    expect((await organizerSignIn(chosen)).statusCode).toBe(200);
  });
});

describe('demo Super Admin', () => {
  it('needs the second factor, is onboarded through enrolTotp, then signs in with a code', async () => {
    const created = await ensureDemoAdmin(h.owner);
    expect(created.created).toBe(true);
    const password = created.password!;
    // Before onboarding: the password alone is refused, as in production.
    const before = await adminSignIn(password);
    expect(before.statusCode).toBe(403);
    expect(before.json().code).toBe('second_factor_required');
    // Onboarding: the reviewer scans the secret and proves possession with a current code.
    const secret = newTotpSecret();
    await enrolTotp(h.owner, TOTP_KEY, ADMIN_EMAIL, secret, totpCode(secret, stepAt(Date.now())));
    // After: password plus a fresh code works; password alone and a wrong code do not.
    expect((await adminSignIn(password)).statusCode).toBe(401);
    expect((await adminSignIn(password, '000000')).statusCode).toBe(401);
    const ok = await adminSignIn(password, totpCode(secret, stepAt(Date.now()) + 1));
    expect(ok.statusCode).toBe(200);
    expect(ok.cookies.some((c) => c.name === '__Host-ers_admin')).toBe(true);
  });

  it('is created once and never changed by a second seed', async () => {
    const first = await ensureDemoAdmin(h.owner);
    expect(await ensureDemoAdmin(h.owner)).toEqual({ created: false, password: null });
    expect((await adminSignIn(first.password!)).statusCode).toBe(403); // still the same account, not yet enrolled
    expect(await h.db.selectFrom('app.platform_admins').select('id').execute()).toHaveLength(1);
  });

  it('refuses a chosen password that is too short', async () => {
    await expect(ensureDemoAdmin(h.owner, 'short')).rejects.toThrow(SeedError);
  });
});

describe('seed guard', () => {
  it('refuses production and non-local database hosts', () => {
    const url = 'postgres://u:p@localhost:5432/db';
    expect(() => assertLocal(url, {})).not.toThrow();
    expect(() => assertLocal(url, { NODE_ENV: 'production' })).toThrow(/production/);
    expect(() => assertLocal('postgres://u:p@db.example.com/db', {})).toThrow(/local database/);
    expect(() => assertLocal('postgres://u:p@postgres/db', {})).toThrow(/local database/);
    expect(() =>
      assertLocal('postgres://u:p@postgres/db', { DEMO_SEED_ALLOW_HOST: 'postgres' }),
    ).not.toThrow();
    expect(() =>
      assertLocal('postgres://u:p@postgres/db', { NODE_ENV: 'production', DEMO_SEED_ALLOW_HOST: 'postgres' }),
    ).toThrow(/production/);
  });
});
