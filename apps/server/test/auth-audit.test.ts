import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformAdmin, enrolTotp, BootstrapError } from '../src/modules/platform-admin/bootstrap.js';
import { openSecret, sealSecret, stepAt, totpCode, verifyTotp } from '../src/platform/totp.js';
import { ORIGIN, createHarness, ensureOrganizer, moveClockTo, resetData, type Harness } from './harness.js';

// K-718 (PD-99): the security audit's additions: the Super Admins' second factor (TOTP), organizer
// session expiry over HTTP, and the cookie attributes of every session kind.

const TOTP_KEY = randomBytes(32).toString('base64');
const ADMIN = 'super@example.test';
const ADMIN_PASSWORD = 'a long admin passphrase';
const PASSWORD = 'correct horse battery staple';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ ADMIN_TOTP_KEY: TOTP_KEY });
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h));

const adminSignIn = (harness: Harness, code?: string, password = ADMIN_PASSWORD) =>
  harness.app.inject({
    method: 'POST',
    url: '/api/admin/sessions',
    headers: { origin: ORIGIN },
    payload: { email: ADMIN, password, ...(code ? { code } : {}) },
  });

describe('TOTP primitives', () => {
  it('match the RFC 6238 test vectors (SHA-1), truncated to six digits', () => {
    const secret = Buffer.from('12345678901234567890');
    expect(totpCode(secret, stepAt(59_000))).toBe('287082'); // 94287082
    expect(totpCode(secret, stepAt(1_111_111_109_000))).toBe('081804'); // 07081804
    expect(totpCode(secret, stepAt(1_234_567_890_000))).toBe('005924'); // 89005924
    expect(totpCode(secret, stepAt(20_000_000_000_000))).toBe('353130'); // 65353130
  });

  it('accept one step of drift either side, never an older or reused step, and nothing malformed', () => {
    const secret = randomBytes(20);
    const now = Date.UTC(2026, 9, 13, 12, 0, 15);
    const step = stepAt(now);
    expect(verifyTotp(secret, totpCode(secret, step), now, null)).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step + 1), now, null)).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, step - 2), now, null)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, step), now, step)).toBeNull(); // already used
    expect(verifyTotp(secret, '12345', now, null)).toBeNull();
    expect(verifyTotp(secret, '12345a', now, null)).toBeNull();
  });

  it('seal secrets so that a changed byte or another key is detected', () => {
    const key = randomBytes(32);
    const secret = randomBytes(20);
    const sealed = sealSecret(key, secret);
    expect(openSecret(key, sealed).equals(secret)).toBe(true);
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => openSecret(key, tampered)).toThrow();
    expect(() => openSecret(randomBytes(32), sealed)).toThrow();
  });
});

describe('the Super Admin second factor', () => {
  async function enrolled() {
    await createPlatformAdmin(h.owner, { email: ADMIN, name: 'Grace', password: ADMIN_PASSWORD });
    const secret = randomBytes(20);
    // Enrolled with the code of the previous step, so the current step is still free for sign-in.
    const earlier = Date.now() - 30_000;
    await enrolTotp(h.owner, TOTP_KEY, ADMIN, secret, totpCode(secret, stepAt(earlier)), earlier);
    return secret;
  }

  it('is enrolled only with a matching code, sealed, and audited', async () => {
    await createPlatformAdmin(h.owner, { email: ADMIN, name: 'Grace', password: ADMIN_PASSWORD });
    const secret = randomBytes(20);
    await expect(enrolTotp(h.owner, TOTP_KEY, ADMIN, secret, '000000')).rejects.toThrow(BootstrapError);
    await expect(
      enrolTotp(h.owner, undefined, ADMIN, secret, totpCode(secret, stepAt(Date.now()))),
    ).rejects.toThrow(/ADMIN_TOTP_KEY/);
    let row = await h.db.selectFrom('app.platform_admins').selectAll().executeTakeFirstOrThrow();
    expect(row.totp_enrolled_at).toBeNull();
    await enrolTotp(h.owner, TOTP_KEY, ADMIN, secret, totpCode(secret, stepAt(Date.now())));
    row = await h.db.selectFrom('app.platform_admins').selectAll().executeTakeFirstOrThrow();
    expect(row.totp_enrolled_at).not.toBeNull();
    expect(row.totp_secret_sealed!.includes(secret)).toBe(false); // never stored in clear
    const audit = await h.db
      .selectFrom('app.audit_records')
      .select('action')
      .where('action', '=', 'platform_admin_totp_enrolled')
      .execute();
    expect(audit).toHaveLength(1);
  });

  it('needs the current code once enrolled; a missing, wrong or reused code gets the wrong-password answer', async () => {
    const secret = await enrolled();
    const missing = await adminSignIn(h);
    expect(missing.statusCode).toBe(401);
    expect(missing.json().code).toBe('invalid_credentials');
    const wrong = await adminSignIn(h, totpCode(secret, stepAt(Date.now()) + 5));
    expect(wrong.json().code).toBe('invalid_credentials');
    const code = totpCode(secret, stepAt(Date.now()));
    const ok = await adminSignIn(h, code);
    expect(ok.statusCode).toBe(200);
    const replay = await adminSignIn(h, code);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe('invalid_credentials');
    const audit = await h.db
      .selectFrom('app.audit_records')
      .select('details')
      .where('action', '=', 'admin_signin')
      .executeTakeFirstOrThrow();
    expect(audit.details).toEqual({ secondFactor: true });
  });

  it('is required where configured (production by default): a correct password alone is refused', async () => {
    const strict = await createHarness({ ADMIN_TOTP_KEY: TOTP_KEY, ADMIN_REQUIRE_TOTP: 'true' });
    try {
      await resetData(strict);
      await createPlatformAdmin(strict.owner, { email: ADMIN, name: 'Grace', password: ADMIN_PASSWORD });
      const wrongPassword = await adminSignIn(strict, undefined, 'not the password at all');
      expect(wrongPassword.statusCode).toBe(401); // nothing revealed without the password
      const noFactor = await adminSignIn(strict);
      expect(noFactor.statusCode).toBe(403);
      expect(noFactor.json().code).toBe('second_factor_required');
      expect(await strict.db.selectFrom('app.platform_admin_sessions').select('id').execute()).toEqual([]);
    } finally {
      await strict.close();
    }
  });
});

describe('organizer sessions and cookies', () => {
  async function passwordSession() {
    await ensureOrganizer(h, 'owner@example.test', PASSWORD);
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/auth/password-sessions',
      headers: { origin: ORIGIN },
      payload: { email: 'owner@example.test', password: PASSWORD },
    });
    const cookie = r.cookies.find((c) => c.name === '__Host-ers_org')!;
    return { cookie, header: `__Host-ers_org=${cookie.value}` };
  }
  const session = (header: string) =>
    h.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: header } });

  it('sets a host-only, Secure, HttpOnly, SameSite=Lax cookie on the whole site', async () => {
    const { cookie } = await passwordSession();
    expect(cookie).toMatchObject({ path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
    expect(cookie.domain).toBeUndefined();
    expect(cookie.name.startsWith('__Host-')).toBe(true);
  });

  it('ends after 7 idle days, and after 30 days however active', async () => {
    const start = Date.now();
    const idle = await passwordSession();
    moveClockTo(new Date(start + 7 * 86_400_000 + 1_000));
    expect((await session(idle.header)).statusCode).toBe(401);

    moveClockTo(new Date(start));
    await resetData(h);
    const active = await passwordSession();
    for (let day = 6; day < 30; day += 6) {
      moveClockTo(new Date(start + day * 86_400_000));
      expect((await session(active.header)).statusCode, `day ${day}`).toBe(200);
    }
    moveClockTo(new Date(start + 30 * 86_400_000 + 1_000));
    expect((await session(active.header)).statusCode).toBe(401);
  });
});
