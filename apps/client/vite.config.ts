import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Two HTML entries on one origin (ADR-013): participant/link pages and the organizer area.
// In development the API runs on :3000 and is proxied, so the browser still sees one origin.
const entryRouter = (): Plugin => ({
  name: 'ers-entry-router',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const path = (req.url ?? '/').split('?')[0]!;
      if (/^\/(e\/|verify$|manage$|ticket$|sign-in$|invite$)/.test(path)) req.url = '/public.html';
      else if (path === '/' || path === '/organizer' || path.startsWith('/organizer/') || path === '/staff')
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
    rollupOptions: {
      input: {
        public: resolve(import.meta.dirname, 'public.html'),
        organizer: resolve(import.meta.dirname, 'organizer.html'),
      },
    },
  },
  test: { environment: 'jsdom' },
});
