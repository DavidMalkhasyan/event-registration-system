import { createHash } from 'node:crypto';
import { publicId, ticketCode } from '../platform/crypto.js';
import { createDatabase } from '../platform/db.js';
import { ConfigError, requireEnv } from '../platform/config.js';
import { decisionTime } from '../platform/tx.js';
import {
  ADMIN_EMAIL,
  ORGANIZER_EMAIL,
  SeedError,
  assertLocal,
  ensureDemoAdmin,
  ensureDemoOrganizer,
} from '../demo/accounts.js';
import { scheduleCutoffTask, scheduleReminderTask } from '../modules/event-core/lifecycle.js';

// Demo data for a local development database: `pnpm seed:demo` (also the demo Super Admin; src/demo/accounts.ts).
// Local only (refuses NODE_ENV=production and any non-loopback database host). Idempotent: the
// organizer account, organization and each event are found by fixed keys and never changed or
// duplicated; nothing else is touched. No email is written and nothing leaves the machine.

const TIME_ZONE = 'Europe/Berlin';
const DAY = 86_400_000;

interface Scenario {
  key: string;
  title: string;
  description: string;
  daysFromNow: number;
  capacity: number;
  confirmed: number;
  waiting: number;
  checkedIn: number;
}

const SCENARIOS: Scenario[] = [
  {
    key: 'tech-meetup',
    title: 'Open Source Meetup',
    description: 'Lightning talks and networking for local open-source contributors.',
    daysFromNow: 14,
    capacity: 40,
    confirmed: 28,
    waiting: 0,
    checkedIn: 0,
  },
  {
    key: 'design-workshop',
    title: 'Hands-on Design Workshop',
    description: 'A small, practical workshop on interface design. Places are limited.',
    daysFromNow: 7,
    capacity: 12,
    confirmed: 12,
    waiting: 5,
    checkedIn: 0,
  },
  {
    key: 'morning-yoga',
    title: 'Morning Yoga in the Park',
    description: 'A relaxed beginner-friendly session. Bring your own mat.',
    daysFromNow: 3,
    capacity: 25,
    confirmed: 18,
    waiting: 0,
    checkedIn: 0,
  },
  {
    key: 'hackathon-kickoff',
    title: 'Hackathon Kickoff',
    description: 'Team forming, rules and a first look at the challenges. Very popular.',
    daysFromNow: 10,
    capacity: 6,
    confirmed: 6,
    waiting: 4,
    checkedIn: 0,
  },
  {
    key: 'pitch-night',
    title: 'Startup Pitch Night',
    description: 'Five founders pitch to a panel; questions from the audience.',
    daysFromNow: 30,
    capacity: 80,
    confirmed: 35,
    waiting: 0,
    checkedIn: 0,
  },
  {
    key: 'cleanup-day',
    title: 'Community Clean-up Day',
    description: 'A neighbourhood clean-up with gloves and bags provided. Completed.',
    daysFromNow: -9,
    capacity: 30,
    confirmed: 24,
    waiting: 0,
    checkedIn: 19,
  },
];

/** Stable UUID-shaped request ID, so a second run finds the same event (events_u27). */
function requestIdOf(key: string): string {
  const h = createHash('sha256').update(`eventflow-demo-seed:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

try {
  const databaseUrl = requireEnv('MIGRATION_DATABASE_URL');
  assertLocal(databaseUrl);
  const origin = process.env.PUBLIC_ORIGIN ?? 'http://localhost:5173';
  const db = createDatabase(databaseUrl, 1);
  const out: string[] = [];
  try {
    // Accounts: the organizer with its approved organization, and the Super Admin (no second factor yet).
    const organizer = await ensureDemoOrganizer(db);
    const admin = await ensureDemoAdmin(db);
    const password = organizer.password;
    const account = { id: organizer.accountId };
    const organization = { organization_id: organizer.organizationId };

    let created = 0;
    for (const s of SCENARIOS) {
      const urlOf = (id: string) => `${origin}/e/${id}`;
      const existing = await db
        .selectFrom('app.events')
        .select('public_id')
        .where('owner_account_id', '=', account.id)
        .where('creation_request_id', '=', requestIdOf(s.key))
        .executeTakeFirst();
      if (existing) {
        out.push(`  ${s.title} (capacity ${s.capacity}, already present): ${urlOf(existing.public_id)}`);
        continue;
      }
      const eventPublicId = publicId();
      await db.transaction().execute(async (trx) => {
        const now = await decisionTime(trx);
        const startsAt = new Date(Math.round((now.getTime() + s.daysFromNow * DAY) / 3_600_000) * 3_600_000);
        // Registrations were made in the days before the event (or before now, for a past one).
        const base = Math.min(now.getTime(), startsAt.getTime()) - 12 * DAY;
        const stamp = (i: number) => new Date(base + i * 600_000);
        const event = await trx
          .insertInto('app.events')
          .values({
            owner_account_id: account.id,
            organization_id: organization.organization_id,
            creation_request_id: requestIdOf(s.key),
            creation_fingerprint: createHash('sha256').update(`demo:${s.key}`).digest(),
            public_id: eventPublicId,
            title: s.title,
            description: s.description,
            starts_at: startsAt,
            time_zone: TIME_ZONE,
            capacity: s.capacity,
            next_waitlist_seq: s.waiting + 1,
            created_at: new Date(base),
            updated_at: new Date(base),
          })
          .returning(['id', 'starts_at'])
          .executeTakeFirstOrThrow();
        if (startsAt > now) {
          await scheduleReminderTask(trx, event.id, 1, event.starts_at, now);
          await scheduleCutoffTask(trx, event.id, 1, event.starts_at, now);
        }
        const person = (i: number) => `${s.key}.guest${String(i).padStart(2, '0')}@example.test`;
        for (let i = 1; i <= s.confirmed; i += 1) {
          const at = stamp(i);
          const reg = await trx
            .insertInto('app.registrations')
            .values({
              event_id: event.id,
              email: person(i),
              state: 'CONFIRMED',
              created_at: at,
              verified_at: at,
              confirmed_at: at,
              updated_at: at,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          const ticket = await trx
            .insertInto('app.tickets')
            .values({ registration_id: reg.id, event_id: event.id, code: ticketCode(), issued_at: at })
            .returning('id')
            .executeTakeFirstOrThrow();
          if (i <= s.checkedIn)
            await trx
              .insertInto('app.check_ins')
              .values({
                ticket_id: ticket.id,
                event_id: event.id,
                checked_in_at: new Date(startsAt.getTime() + i * 60_000),
                actor_kind: 'owner',
                actor_account_id: account.id,
              })
              .execute();
        }
        for (let w = 1; w <= s.waiting; w += 1) {
          const at = stamp(s.confirmed + w);
          await trx
            .insertInto('app.registrations')
            .values({
              event_id: event.id,
              email: person(s.confirmed + w),
              state: 'WAITLISTED',
              waitlist_seq: w,
              created_at: at,
              verified_at: at,
              waitlisted_at: at,
              updated_at: at,
            })
            .execute();
        }
      });
      created += 1;
      out.push(`  ${s.title} (capacity ${s.capacity}, created): ${urlOf(eventPublicId)}`);
    }

    process.stdout.write(
      `Demo data: ${created} of ${SCENARIOS.length} events created${created === 0 ? ' (nothing to do)' : ''}.\n` +
        `Organizer sign-in: ${origin}/organizer\n  Email: ${ORGANIZER_EMAIL}\n` +
        (password
          ? `  Password: ${password}\n  (shown once; set DEMO_ORGANIZER_PASSWORD before the first run to choose it)\n`
          : '  Password: not shown (account already existed, or the password was set with DEMO_ORGANIZER_PASSWORD)\n') +
        `Super Admin sign-in: ${origin}/admin\n  Email: ${ADMIN_EMAIL}\n` +
        (admin.password
          ? `  Password: ${admin.password}\n  (shown once; set DEMO_ADMIN_PASSWORD before the first run to choose it)\n`
          : '  Password: not shown (account already existed, or the password was set with DEMO_ADMIN_PASSWORD)\n') +
        (process.env.DEMO_MODE === 'true'
          ? '  Second factor: not required in the local Docker demo\n'
          : '  Second factor: enrol once with admin:totp before the first sign-in (see docs/QUICKSTART_RU.md)\n') +
        `Public event pages:\n${out.join('\n')}\n`,
    );
  } finally {
    await db.destroy();
  }
} catch (error) {
  const known = error instanceof SeedError || error instanceof ConfigError;
  process.stderr.write(
    `${known ? (error as Error).message : 'seed:demo failed: ' + (error as Error).message}\n`,
  );
  process.exit(1);
}
