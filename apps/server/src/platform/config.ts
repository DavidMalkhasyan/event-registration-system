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
  PREVIEW_SECRET: secret, // K_preview: event-deletion preview tokens (ADR-010 §7)
  EMAIL_PROVIDER: z.enum(['fake', 'resend']).default('fake'),
  // K-717: Resend. The key is a secret: never logged, never printed by the configuration check.
  RESEND_API_KEY: z
    .string()
    .regex(/^re_[A-Za-z0-9_]{8,}$/, 'must be a Resend API key')
    .optional(),
  RESEND_API_URL: z.url().default('https://api.resend.com'),
  EMAIL_FROM: z
    .string()
    .regex(
      /^(?:[^<>@\r\n]{1,100} <[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/,
      'an address, or "Name <address>"',
    )
    .optional(),
  EMAIL_REPLY_TO: z.email().optional(),
  DEV_MAILBOX_DIR: z.string().min(1).default('var/mailbox'),
  CLIENT_DIST_DIR: z.string().min(1).optional(),
  // K-712: where event images are stored (outside the repository; `var/` is ignored by Git).
  MEDIA_DIR: z.string().min(1).default('var/media'),
  // K-714: the participant map's tile source, the operator contact sent in the User-Agent (the map is
  // off without it), and the tile cache (outside the repository).
  MAP_TILE_URL: z
    .url()
    .refine((u) => ['{z}', '{x}', '{y}'].every((p) => u.includes(p)), 'needs {z}, {x} and {y}')
    .default('https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
  MAP_TILE_CONTACT: z.string().trim().min(3).max(200).optional(),
  TILE_CACHE_DIR: z.string().min(1).default('var/tile-cache'),
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
  if (!isAbsolute(config.MEDIA_DIR)) config.MEDIA_DIR = resolve(REPO_ROOT, config.MEDIA_DIR);
  if (!isAbsolute(config.TILE_CACHE_DIR)) config.TILE_CACHE_DIR = resolve(REPO_ROOT, config.TILE_CACHE_DIR);
  if (config.NODE_ENV === 'production' && !config.MAP_TILE_URL.startsWith('https://')) {
    throw new ConfigError(['MAP_TILE_URL (must be https in production)']);
  }
  if (config.CLIENT_DIST_DIR && !isAbsolute(config.CLIENT_DIST_DIR))
    config.CLIENT_DIST_DIR = resolve(REPO_ROOT, config.CLIENT_DIST_DIR);
  if (config.EMAIL_PROVIDER === 'resend') {
    const missing = [
      ...(config.RESEND_API_KEY ? [] : ['RESEND_API_KEY (required for EMAIL_PROVIDER=resend)']),
      ...(config.EMAIL_FROM ? [] : ['EMAIL_FROM (required for EMAIL_PROVIDER=resend)']),
      ...(config.NODE_ENV === 'production' && !config.RESEND_API_URL.startsWith('https://')
        ? ['RESEND_API_URL (must be https in production)']
        : []),
    ];
    if (missing.length) throw new ConfigError(missing);
  }
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
