import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RenderedEmail } from '../notifications/handlers.js';

// Fake email provider (ENG-TST-9) for development, tests and demos. It writes each accepted
// email as a JSON file into a local mailbox directory, outside the database: the raw link
// tokens in an email belong to the recipient's side, never to our tables (BR-19, AC-61).
// Idempotency follows Resend's documented rule: same key + same body = replay; different body = 409.

export interface ProviderResult {
  /**
   * What happened to the submission (K-717): accepted (or replayed) means the provider took it; the
   * other categories never claim acceptance. `ambiguous` (also any thrown error) means it may have been.
   */
  category:
    | 'accepted'
    | 'replayed'
    | 'idempotent_key_conflict'
    | 'concurrent_conflict'
    | 'rate_limited'
    | 'config_fault'
    | 'permanent'
    | 'ambiguous';
  providerMessageId?: string;
  httpStatus?: number;
  /** The provider's error name (for example `validation_error`), never a message body. */
  errorCode?: string;
  retryAfterSeconds?: number;
}

export interface EmailProvider {
  send(input: {
    idempotencyKey: string;
    to: string;
    email: RenderedEmail;
    tags: Record<string, string>;
  }): Promise<ProviderResult>;
}

export interface MailboxEntry {
  id: string;
  createdAt: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  tags: Record<string, string>;
}

export class FakeEmailProvider implements EmailProvider {
  constructor(private readonly dir: string) {
    mkdirSync(join(dir, 'keys'), { recursive: true });
  }

  async send(input: {
    idempotencyKey: string;
    to: string;
    email: RenderedEmail;
    tags: Record<string, string>;
  }): Promise<ProviderResult> {
    mkdirSync(join(this.dir, 'keys'), { recursive: true });
    const keyFile = join(
      this.dir,
      'keys',
      `${createHash('sha256').update(input.idempotencyKey).digest('hex')}.json`,
    );
    const bodyHash = createHash('sha256')
      .update(JSON.stringify([input.to, input.email]))
      .digest('hex');
    if (existsSync(keyFile)) {
      const previous = JSON.parse(readFileSync(keyFile, 'utf8')) as { bodyHash: string; id: string };
      return previous.bodyHash === bodyHash
        ? { category: 'replayed', providerMessageId: previous.id }
        : { category: 'idempotent_key_conflict' };
    }
    const id = `fake_${randomUUID()}`;
    const entry: MailboxEntry = {
      id,
      createdAt: new Date().toISOString(),
      to: input.to,
      ...input.email,
      tags: input.tags,
    };
    // Record the key first: a crash after this point is replayed, never delivered twice.
    writeFileSync(keyFile, JSON.stringify({ bodyHash, id }));
    writeFileSync(join(this.dir, `${Date.now()}-${id}.json`), JSON.stringify(entry, null, 2));
    return { category: 'accepted', providerMessageId: id };
  }
}

/** Development mailbox reader (used by the dev mailbox page and by tests). Newest first. */
export function readMailbox(dir: string): MailboxEntry[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as MailboxEntry);
}
