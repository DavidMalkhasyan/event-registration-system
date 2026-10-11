import type { Config } from '../platform/config.js';
import type { Database } from '../platform/db.js';
import type { RateLimiter } from '../platform/ratelimit.js';

export interface AppContext {
  db: Database;
  config: Config;
  limiter: RateLimiter;
}
