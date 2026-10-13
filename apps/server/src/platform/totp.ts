import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Time-based one-time passwords (RFC 6238 over RFC 4226; HMAC-SHA1, 6 digits, 30-second steps), the
// format every authenticator app reads (K-718, PD-99). Node's crypto only; no home-grown cryptography.
// Secrets are stored encrypted with AES-256-GCM under an operator key (ADMIN_TOTP_KEY); a verified code
// returns its time step, which the caller stores so the same code cannot be used twice.

const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function newTotpSecret(): Buffer {
  return randomBytes(20); // 160 bits, as RFC 4226 recommends
}

/** The code for one time step (RFC 4226 dynamic truncation). */
export function totpCode(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(binary).padStart(DIGITS, '0');
}

export const stepAt = (epochMs: number) => Math.floor(epochMs / 1000 / STEP_SECONDS);

/**
 * The step a code belongs to, within one step either side of now (clock drift), and later than the
 * last step already used; null otherwise.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  epochMs: number,
  lastStep: number | null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepAt(epochMs);
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

/** The otpauth URI authenticator apps import (shown once to the operator who enrolls). */
export function otpauthUri(secret: Buffer, account: string, issuer = 'EventFlow'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** AES-256-GCM: 12-byte IV, 16-byte tag, ciphertext. */
export function sealSecret(key: Buffer, secret: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function openSecret(key: Buffer, sealed: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
}

export function totpKeyFrom(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error('ADMIN_TOTP_KEY must be 32 bytes, base64-encoded');
  return key;
}
