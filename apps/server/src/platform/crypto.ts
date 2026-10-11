import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// D-6: SHA-256 with domain separation for random tokens and session IDs.
export type HashDomain =
  | 'verification'
  | 'management'
  | 'share'
  | 'staff_invitation'
  | 'sign_in'
  | 'email_change'
  | 'organizer_session'
  | 'staff_session';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes, base64url (43 characters). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Returns null for a malformed token, which callers treat like an unknown token. */
export function hashToken(domain: HashDomain, raw: string): Buffer | null {
  if (!TOKEN_PATTERN.test(raw)) return null;
  return createHash('sha256')
    .update(`ers/v1/${domain}`)
    .update(Buffer.from([0]))
    .update(Buffer.from(raw, 'base64url'))
    .digest();
}

export function hmac(secret: string, ...parts: string[]): string {
  const mac = createHmac('sha256', secret);
  parts.forEach((part, index) => {
    if (index > 0) mac.update(Buffer.from([0]));
    mac.update(part);
  });
  return mac.digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 12-character Crockford Base32 ticket code (60 bits; FR-TKT-1, FR-TKT-2). */
export function ticketCode(): string {
  const bytes = randomBytes(12);
  let code = '';
  for (const byte of bytes) code += CROCKFORD[byte & 31];
  return code;
}

/** Normalizes typed codes: upper case, separators removed, Crockford look-alikes mapped. */
export function normalizeTicketCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** Unguessable public event identifier (FR-EVT-12). */
export function publicId(): string {
  return randomBytes(16).toString('base64url');
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Canonical JSON (sorted keys) for request fingerprints (D-17). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const [host = '', ...rest] = domain.split('.');
  const mask = (part: string) => (part.length <= 1 ? '*' : `${part[0]}***`);
  return `${mask(local)}@${mask(host)}${rest.length ? `.${rest.join('.')}` : ''}`;
}
