import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL,
  DEMO_ADMIN_PASSWORD,
  DEMO_ORGANIZER_PASSWORD,
  ORGANIZER_EMAIL,
  ensureDemoAdmin,
  ensureDemoOrganizer,
} from '../src/demo/accounts.js';
import { ORIGIN, createHarness, resetData, type Harness } from './harness.js';

// The local Docker demo (DEMO_MODE=true): the two static-password accounts sign in, the Super Admin
// without a second factor, and role separation holds. Production refusal: email-provider.test.ts.

let demo: Harness;
beforeAll(async () => {
  demo = await createHarness({ DEMO_MODE: 'true' });
});
afterAll(async () => demo.close());
beforeEach(async () => resetData(demo));

describe('demo mode', () => {
  it('signs in with the password alone when DEMO_MODE is on, and the roles stay separate', async () => {
    await ensureDemoAdmin(demo.owner, DEMO_ADMIN_PASSWORD);
    await ensureDemoOrganizer(demo.owner, DEMO_ORGANIZER_PASSWORD);
    const post = (url: string, payload: object) =>
      demo.app.inject({ method: 'POST', url, headers: { origin: ORIGIN }, payload });
    const ok = await post('/api/admin/sessions', { email: ADMIN_EMAIL, password: DEMO_ADMIN_PASSWORD });
    expect(ok.statusCode).toBe(200);
    expect(ok.cookies.some((c) => c.name === '__Host-ers_admin')).toBe(true);
    expect(
      (await post('/api/admin/sessions', { email: ADMIN_EMAIL, password: 'not the password' })).statusCode,
    ).toBe(401);
    // The organizer's password is not a Super Admin credential, and the reverse.
    expect(
      (await post('/api/admin/sessions', { email: ORGANIZER_EMAIL, password: DEMO_ORGANIZER_PASSWORD }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await post('/api/auth/password-sessions', {
          email: ORGANIZER_EMAIL,
          password: DEMO_ORGANIZER_PASSWORD,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await post('/api/auth/password-sessions', { email: ADMIN_EMAIL, password: DEMO_ADMIN_PASSWORD }))
        .statusCode,
    ).toBe(401);
  });
});
