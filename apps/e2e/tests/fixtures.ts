import { test as base } from '@playwright/test';
import { resetRateLimitCounters } from './db.js';

export { expect } from '@playwright/test';
export type { Browser, BrowserContext, Page } from '@playwright/test';

/** Playwright's test with per-test isolation of the rate-limit counters (see db.ts). */
export const test = base.extend<{ isolatedRateLimits: void }>({
  isolatedRateLimits: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their dependencies
    async ({}, use) => {
      await resetRateLimitCounters();
      await use();
    },
    { auto: true },
  ],
});
