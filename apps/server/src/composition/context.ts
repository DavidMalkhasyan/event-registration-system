import type { Config } from '../platform/config.js';
import type { Database } from '../platform/db.js';
import type { RateLimiter } from '../platform/ratelimit.js';
import type { MediaStorage } from '../modules/media/storage.js';

export interface AppContext {
  db: Database;
  config: Config;
  limiter: RateLimiter;
  /** K-712: event image files. */
  media: MediaStorage;
}
