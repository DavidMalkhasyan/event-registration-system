import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

// Organizer passwords (K-709, PD-89): Argon2id from Node's crypto module (no home-grown scheme), with
// the OWASP Password Storage Cheat Sheet's recommended minimum (19 MiB, 2 passes, parallelism 1), a
// 16-byte random salt per password, stored as a standard PHC string. Passwords are never logged or
// stored in plain text; verification compares in constant time.

const PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

function derive(
  password: string,
  salt: Buffer,
  p: { memory: number; passes: number; parallelism: number; tagLength: number },
) {
  return new Promise<Buffer>((resolve, reject) =>
    argon2('argon2id', { message: password, nonce: salt, ...p }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

/** `$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>` (base64 without padding, as in the PHC format). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, PARAMS);
  const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${b64(salt)}$${b64(hash)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** Constant-time check of a password against a stored PHC string; false for anything malformed. */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const m = PHC.exec(stored);
  if (!m) return false;
  const expected = Buffer.from(m[5]!, 'base64');
  const actual = await derive(password, Buffer.from(m[4]!, 'base64'), {
    memory: Number(m[1]),
    passes: Number(m[2]),
    parallelism: Number(m[3]),
    tagLength: expected.length,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Compared against when the address has no password, so a sign-in takes the same time either way.
let dummy: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(24).toString('base64'));
  return dummy;
}
