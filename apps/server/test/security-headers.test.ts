import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWebApp } from '../src/composition/web-app.js';
import { GENERIC_INVALID_LINK_BODY } from '../src/platform/errors.js';
import { API_CSP, PAGE_CSP } from '../src/platform/http.js';
import { createHarness, type Harness } from './harness.js';

// FR-LNK-8, AC-51: the real response headers of the HTML entries and the API. The client build is
// replaced by a temporary dist directory, so this runs before (and without) `pnpm build`.

let h: Harness;
let app: FastifyInstance;
let dist: string;
beforeAll(async () => {
  h = await createHarness();
  dist = mkdtempSync(join(tmpdir(), 'ers-dist-'));
  mkdirSync(join(dist, 'assets'));
  for (const name of ['public', 'organizer', 'staff', 'admin'])
    writeFileSync(join(dist, `${name}.html`), `<!doctype html><title>${name}</title><div id="root"></div>`);
  writeFileSync(join(dist, 'assets', 'app.js'), 'export {};');
  app = await buildWebApp({ ...h.config, CLIENT_DIST_DIR: dist }, h.db, { logger: false });
});
afterAll(async () => {
  await app.close();
  await h.close();
  rmSync(dist, { recursive: true, force: true });
});

function expectPageHeaders(headers: Record<string, unknown>, label: string) {
  expect(headers['content-type'], label).toMatch(/^text\/html/);
  expect(headers['content-security-policy'], label).toBe(PAGE_CSP);
  expect(headers['referrer-policy'], label).toBe('no-referrer');
  expect(headers['cache-control'], label).toBe('no-store');
  expect(headers['x-robots-tag'], label).toBe('noindex, nofollow');
  expect(headers['x-frame-options'], label).toBe('DENY');
  expect(headers['access-control-allow-origin'], label).toBeUndefined();
}

describe('security headers (FR-LNK-8, AC-51)', () => {
  it('the policy allows scripts only from our origin, no inline code, and forbids framing', () => {
    const directives = Object.fromEntries(
      PAGE_CSP.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1).join(' ')]),
    );
    expect(directives['script-src']).toBe("'self'");
    expect(directives['frame-ancestors']).toBe("'none'");
    expect(directives['object-src']).toBe("'none'");
    expect(PAGE_CSP).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/);
  });

  it('every link page, and the organizer, staff and Super Admin entries, carry the page headers', async () => {
    const paths = [
      '/e/abcdefghijklmnopqrstuv',
      '/verify',
      '/manage',
      '/ticket',
      '/sign-in',
      '/invite',
      '/',
      '/organizer',
      '/organizer/events/new',
      '/staff',
      '/verify-account',
      '/reset-password',
      '/admin',
      '/admin/organizations',
      // The HTML files under their own names (served by the static plugin) are no way around it.
      '/public.html',
      '/organizer.html',
      '/staff.html',
      '/admin.html',
    ];
    for (const url of paths) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(200);
      expectPageHeaders(response.headers, url);
    }
  });

  it('link API responses, including the generic invalid-link response, carry the API headers', async () => {
    for (const url of [
      '/api/links/manage',
      '/api/links/ticket',
      '/api/links/verify',
      '/api/links/invite',
      '/api/links/sign-in',
    ]) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Link ${'A'.repeat(43)}` },
      });
      expect(response.statusCode, url).toBe(404);
      expect(response.body).toBe(GENERIC_INVALID_LINK_BODY);
      expect(response.headers['content-security-policy'], url).toBe(API_CSP);
      expect(response.headers['referrer-policy'], url).toBe('no-referrer');
      expect(response.headers['cache-control'], url).toBe('no-store');
      expect(response.headers['x-robots-tag'], url).toBe('noindex, nofollow');
      expect(response.headers['access-control-allow-origin'], url).toBeUndefined();
    }
    const session = await app.inject({ method: 'GET', url: '/api/auth/session' });
    expect(session.statusCode).toBe(401);
    expect(session.headers['content-security-policy']).toBe(API_CSP);
    expect(session.headers['cache-control']).toBe('no-store');
  });

  it('static scripts get no page policy of their own, and are not HTML', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/javascript/);
    expect(response.headers['content-security-policy']).toBeUndefined();
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });
});
