import { z } from 'zod';
import { normalizeEmail } from '../../platform/crypto.js';
import type { Database } from '../../platform/db.js';
import { PASSWORD_MAX, PASSWORD_MIN, hashPassword } from '../../platform/passwords.js';
import { decisionTime } from '../../platform/tx.js';
import { recordAudit } from '../audit/audit.js';

// Operator commands for Super Admins (K-710, PD-90), run on the server with the owner database
// connection: `pnpm admin:create` and `pnpm admin:disable`. Nothing here is reachable over HTTP.
// No address or password is built in; the password is read without echo and never printed or logged.

const input = z.object({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(200),
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
});

export class BootstrapError extends Error {}

/** Creates one Super Admin. Refuses an address that already is one (it never changes an existing admin). */
export async function createPlatformAdmin(
  db: Database,
  raw: { email: string; name: string; password: string },
): Promise<{ id: string; email: string }> {
  const parsed = input.safeParse({ ...raw, email: normalizeEmail(raw.email) });
  if (!parsed.success)
    throw new BootstrapError(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '),
    );
  const email = normalizeEmail(parsed.data.email);
  const passwordHash = await hashPassword(parsed.data.password);
  return db.transaction().execute(async (trx) => {
    const now = await decisionTime(trx);
    const created = await trx
      .insertInto('app.platform_admins')
      .values({
        email,
        display_name: parsed.data.name,
        password_hash: passwordHash,
        created_at: now,
        password_changed_at: now,
      })
      .onConflict((oc) => oc.column('email').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!created) throw new BootstrapError(`${email} is already a Super Admin; nothing was changed`);
    await recordAudit(trx, {
      now,
      action: 'platform_admin_created',
      actorKind: 'system',
      subjectId: created.id,
      outcome: 'success',
      details: { via: 'operator_command' },
    });
    return { id: created.id, email };
  });
}

/** Disables a Super Admin and ends its sessions. */
export async function disablePlatformAdmin(db: Database, rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  await db.transaction().execute(async (trx) => {
    const now = await decisionTime(trx);
    const admin = await trx
      .updateTable('app.platform_admins')
      .set({ disabled_at: now })
      .where('email', '=', email)
      .where('disabled_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (!admin) throw new BootstrapError(`${email} is not an enabled Super Admin; nothing was changed`);
    await trx
      .updateTable('app.platform_admin_sessions')
      .set({ revoked_at: now, revoke_reason: 'admin_disabled' })
      .where('admin_id', '=', admin.id)
      .where('revoked_at', 'is', null)
      .execute();
    await recordAudit(trx, {
      now,
      action: 'platform_admin_disabled',
      actorKind: 'system',
      subjectId: admin.id,
      outcome: 'success',
      details: { via: 'operator_command' },
    });
  });
}
