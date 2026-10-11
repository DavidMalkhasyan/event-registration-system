import { defineConfig, devices } from '@playwright/test';
import { ORIGIN } from './tests/env.js';

// Browser end-to-end tests against real processes and the real PostgreSQL test database.
// Locally the installed Microsoft Edge can be used (PW_CHANNEL=msedge); CI installs Chromium.
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../../var/e2e-report' }]],
  outputDir: '../../var/e2e-results',
  use: {
    baseURL: ORIGIN,
    timezoneId: 'Europe/Berlin',
    locale: 'en-GB',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
      },
    },
  ],
  webServer: {
    command: 'pnpm exec tsx stack.ts',
    url: `${ORIGIN}/healthz`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
