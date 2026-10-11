import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Repository root (apps/server/src/platform or apps/server/dist/platform → four levels up). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

// Fail-fast configuration (ENG-DOC-2, AC-143): a missing or invalid variable is reported by
// name only; values are never printed.
const secret = z.string().min(32, 'must be at least 32 characters');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_ORIGIN: z.url(),
  DATABASE_URL: z.string().min(1),
  CSRF_SECRET: secret,
  PRESESSION_SECRET: secret,
  RATE_LIMIT_SECRET: secret,
  EMAIL_PROVIDER: z.enum(['fake']).default('fake'),
  DEV_MAILBOX_DIR: z.string().min(1).default('var/mailbox'),
  CLIENT_DIST_DIR: z.string().min(1).optional(),
});

export type Config = z.infer<typeof schema>;

export class ConfigError extends Error {
  constructor(readonly variables: string[]) {
    super(`Missing or invalid environment variables: ${variables.join(', ')}`);
  }
}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((i) => String(i.path[0] ?? 'unknown')))];
    throw new ConfigError(names);
  }
  const config = result.data;
  // Relative paths are relative to the repository root, whichever package directory a process runs from.
  if (!isAbsolute(config.DEV_MAILBOX_DIR))
    config.DEV_MAILBOX_DIR = resolve(REPO_ROOT, config.DEV_MAILBOX_DIR);
  if (config.CLIENT_DIST_DIR && !isAbsolute(config.CLIENT_DIST_DIR))
    config.CLIENT_DIST_DIR = resolve(REPO_ROOT, config.CLIENT_DIST_DIR);
  if (config.NODE_ENV === 'production' && config.EMAIL_PROVIDER === 'fake') {
    throw new ConfigError(['EMAIL_PROVIDER (the fake provider is not allowed in production)']);
  }
  return config;
}

export function requireEnv(name: string, env: Record<string, string | undefined> = process.env): string {
  const value = env[name];
  if (!value) throw new ConfigError([name]);
  return value;
}

/** Entry points call this: print the variable names and exit non-zero (AC-143). */
export function loadConfigOrExit(): Config {
  try {
    return parseConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}
