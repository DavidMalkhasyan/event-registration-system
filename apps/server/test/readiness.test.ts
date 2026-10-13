import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectedSchemaVersion } from '../src/platform/migrations.js';
import { createHarness, resetData, type Harness } from './harness.js';

// K-720 (PD-101): liveness and readiness for deployments.

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  await resetData(h);
});
afterAll(async () => h.close());

describe('health endpoints', () => {
  it('reports ready with the expected schema and a writable media directory', async () => {
    const live = await h.app.inject({ method: 'GET', url: '/healthz' });
    expect(live.json()).toEqual({ schemaVersion: expectedSchemaVersion(), database: 'ok' });
    const ready = await h.app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      ready: true,
      database: 'ok',
      schemaVersion: expectedSchemaVersion(),
      expectedSchemaVersion: expectedSchemaVersion(),
      media: 'ok',
      oldestDueEmailSeconds: null,
    });
  });

  it('is not ready when the media directory cannot be written', async () => {
    const blocked = join(tmpdir(), `ers-ready-${Date.now()}`);
    writeFileSync(blocked, 'not a directory');
    const broken = await createHarness({ MEDIA_DIR: blocked });
    try {
      const r = await broken.app.inject({ method: 'GET', url: '/readyz' });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ ready: false, media: 'not writable', database: 'ok' });
    } finally {
      await broken.close();
      rmSync(blocked, { force: true, recursive: true });
    }
  });
});

describe('behind a reverse proxy', () => {
  const register = (app: Harness['app'], forwardedFor: string, i: number) =>
    app.inject({
      method: 'POST',
      url: '/api/organizations/registrations',
      headers: { origin: 'http://localhost:5173', 'x-forwarded-for': forwardedFor },
      payload: {
        organizationName: 'Org',
        contactName: 'A',
        email: `p${i}-${forwardedFor}@example.test`,
        password: 'correct horse battery staple',
      },
    });

  it('limits each forwarded client separately when one proxy is trusted, and ignores the header otherwise', async () => {
    const proxied = await createHarness({ TRUST_PROXY_HOPS: '1' });
    try {
      await resetData(proxied);
      for (let i = 0; i < 10; i += 1)
        expect((await register(proxied.app, '203.0.113.1', i)).statusCode).toBe(202);
      expect((await register(proxied.app, '203.0.113.1', 10)).statusCode).toBe(429);
      expect((await register(proxied.app, '203.0.113.2', 11)).statusCode).toBe(202); // another client
    } finally {
      await proxied.close();
    }
    await resetData(h); // default: no proxy trusted, the header changes nothing
    for (let i = 0; i < 10; i += 1)
      expect((await register(h.app, `198.51.100.${i}`, i)).statusCode).toBe(202);
    expect((await register(h.app, '198.51.100.99', 10)).statusCode).toBe(429);
  }, 60_000);
});
