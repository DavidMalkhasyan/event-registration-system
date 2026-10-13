import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Four HTML entries on one origin (ADR-013): participant/link pages, the organizer area, the staff
// device page (PD-69) and the Super Admin area (K-710).
// In development the API runs on :3000 and is proxied, so the browser still sees one origin.
const entryRouter = (): Plugin => ({
  name: 'ers-entry-router',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const path = (req.url ?? '/').split('?')[0]!;
      if (/^\/(e\/|verify$|manage$|ticket$|sign-in$|invite$|verify-account$|reset-password$)/.test(path))
        req.url = '/public.html';
      else if (path === '/staff') req.url = '/staff.html';
      else if (path === '/admin' || path.startsWith('/admin/')) req.url = '/admin.html';
      else if (path === '/' || path === '/organizer' || path.startsWith('/organizer/'))
        req.url = '/organizer.html';
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), entryRouter()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000' },
      '/dev': { target: 'http://127.0.0.1:3000' },
      '/healthz': { target: 'http://127.0.0.1:3000' },
    },
  },
  build: {
    // PD-71 (FR-LNK-10 b): no modulepreload polyfill. It would be emitted as a static import of the
    // public entry and so run before the token bootstrap; every supported browser preloads natively.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        public: resolve(import.meta.dirname, 'public.html'),
        organizer: resolve(import.meta.dirname, 'organizer.html'),
        staff: resolve(import.meta.dirname, 'staff.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
  test: { environment: 'jsdom' },
});
