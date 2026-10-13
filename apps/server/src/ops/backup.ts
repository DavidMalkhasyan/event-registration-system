import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import pg from 'pg';

// Backups and the restore drill (K-721, PD-101). A backup is a directory with:
//   database.dump   pg_dump custom format (schema, data, grants) of the application database
//   media/          a copy of MEDIA_DIR/images (the image files; the database holds only their metadata)
//   manifest.json   when, the schema version, row counts and consistency figures, and the size and SHA-256
//                   of every media file
// A backup is only trusted after a restore drill: restoreDrill() restores it into a new, throwaway
// database on the same server, compares the counts, checks the consistency rules and every image file,
// and drops the database again. Passwords reach pg_dump and pg_restore through PGPASSWORD, never the
// command line (process lists are readable by other users). Backups contain personal data: they belong
// on encrypted, access-controlled storage, never in the repository.

export const TABLES = [
  'accounts',
  'organizations',
  'organization_memberships',
  'organization_invitations',
  'platform_admins',
  'events',
  'registrations',
  'tickets',
  'check_ins',
  'staff_invitations',
  'staff_sessions',
  'event_images',
  'access_tokens',
  'outbox_messages',
  'audit_records',
] as const;

/** Rules a consistent database satisfies; each query counts violations (0 expected). */
export const CONSISTENCY: Record<string, string> = {
  activeOrganizationsWithoutOwner: `SELECT count(*) FROM app.organizations o WHERE o.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM app.organization_memberships m WHERE m.organization_id = o.id AND m.role = 'owner')`,
  confirmedWithoutOneTicket: `SELECT count(*) FROM app.registrations r WHERE r.state = 'CONFIRMED'
    AND (SELECT count(*) FROM app.tickets t WHERE t.registration_id = r.id) <> 1`,
  ticketsOfAnotherEvent: `SELECT count(*) FROM app.tickets t JOIN app.registrations r ON r.id = t.registration_id
    WHERE r.event_id <> t.event_id`,
  checkInsOfAnotherEvent: `SELECT count(*) FROM app.check_ins c JOIN app.tickets t ON t.id = c.ticket_id
    WHERE t.event_id <> c.event_id`,
  confirmedCountMismatch: `SELECT count(*) FROM app.events e WHERE e.confirmed_count <>
    (SELECT count(*) FROM app.registrations r WHERE r.event_id = e.id AND r.state = 'CONFIRMED')`,
  staffSessionsOfAnotherEvent: `SELECT count(*) FROM app.staff_sessions s JOIN app.staff_invitations i ON i.id = s.invitation_id
    WHERE i.event_id <> s.event_id`,
  membershipsWithoutAccount: `SELECT count(*) FROM app.organization_memberships m
    WHERE NOT EXISTS (SELECT 1 FROM app.accounts a WHERE a.id = m.account_id)`,
};

export interface Manifest {
  format: 1;
  createdAt: string;
  schemaVersion: number;
  counts: Record<string, number>;
  consistency: Record<string, number>;
  media: { files: number; bytes: number; sha256: Record<string, string> };
}

function credentials(url: string): { url: string; password: string | undefined } {
  const u = new URL(url);
  const password = u.password ? decodeURIComponent(u.password) : undefined;
  u.password = '';
  return { url: u.toString(), password };
}

function run(bin: string, args: string[], password: string | undefined): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, {
      env: { ...process.env, ...(password ? { PGPASSWORD: password } : {}) },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${bin} exited with ${code}: ${err.trim().slice(0, 500)}`)),
    );
  });
}

const tool = (pgBin: string | undefined, name: string) => (pgBin ? join(pgBin, name) : name);

async function measure(databaseUrl: string): Promise<Omit<Manifest, 'format' | 'createdAt' | 'media'>> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const version = await client.query<{ v: number }>('SELECT max(version) AS v FROM app.schema_migrations');
    const counts: Record<string, number> = {};
    for (const t of TABLES)
      counts[t] = Number((await client.query(`SELECT count(*) AS n FROM app.${t}`)).rows[0].n);
    const consistency: Record<string, number> = {};
    for (const [name, q] of Object.entries(CONSISTENCY))
      consistency[name] = Number((await client.query(q)).rows[0].count);
    return { schemaVersion: Number(version.rows[0]?.v ?? 0), counts, consistency };
  } finally {
    await client.end();
  }
}

async function* files(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.isFile()) yield p;
  }
}

async function hashes(root: string) {
  const sha256: Record<string, string> = {};
  let bytes = 0;
  for await (const f of files(root)) {
    const data = await readFile(f);
    bytes += data.length;
    sha256[relative(root, f).split(sep).join('/')] = createHash('sha256').update(data).digest('hex');
  }
  return { files: Object.keys(sha256).length, bytes, sha256 };
}

/** `pnpm ops:backup`: database dump, media copy and manifest into `outDir` (which must not exist yet). */
export async function backup(opts: {
  databaseUrl: string;
  mediaDir: string;
  outDir: string;
  pgBin?: string;
}): Promise<Manifest> {
  await mkdir(dirname(opts.outDir), { recursive: true });
  await mkdir(opts.outDir, { recursive: false }); // never into an existing backup
  const { url, password } = credentials(opts.databaseUrl);
  await run(
    tool(opts.pgBin, 'pg_dump'),
    ['--format=custom', '--no-password', `--file=${join(opts.outDir, 'database.dump')}`, url],
    password,
  );
  const mediaOut = join(opts.outDir, 'media', 'images');
  await mkdir(mediaOut, { recursive: true });
  const source = join(opts.mediaDir, 'images');
  if ((await stat(source).catch(() => null))?.isDirectory())
    await cp(source, mediaOut, { recursive: true, filter: (src) => !src.endsWith('.tmp') });
  const manifest: Manifest = {
    format: 1,
    createdAt: new Date().toISOString(),
    ...(await measure(opts.databaseUrl)),
    media: await hashes(mediaOut),
  };
  await writeFile(join(opts.outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

export interface DrillReport {
  ok: boolean;
  database: string;
  schemaVersion: { expected: number; restored: number };
  counts: Record<string, { expected: number; restored: number }>;
  consistency: Record<string, number>;
  media: { files: number; checksumMismatches: string[]; missingForRows: string[] };
  problems: string[];
  dropped: boolean;
}

/**
 * `pnpm ops:restore-drill`: restores a backup into a new database (named ers_restore_drill_<random>) with
 * the administrator connection `adminUrl` (a role that may create databases), checks it, and drops it
 * unless `keep` is set. Never touches the source database or its media directory.
 */
export async function restoreDrill(opts: {
  backupDir: string;
  adminUrl: string;
  pgBin?: string;
  keep?: boolean;
}) {
  const manifest = JSON.parse(await readFile(join(opts.backupDir, 'manifest.json'), 'utf8')) as Manifest;
  const name = `ers_restore_drill_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: opts.adminUrl });
  await admin.connect();
  const problems: string[] = [];
  let report: DrillReport | undefined;
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    const target = new URL(opts.adminUrl);
    target.pathname = `/${name}`;
    const { url, password } = credentials(target.toString());
    await run(
      tool(opts.pgBin, 'pg_restore'),
      ['--exit-on-error', '--no-password', `--dbname=${url}`, join(opts.backupDir, 'database.dump')],
      password,
    );
    const restored = await measure(target.toString());

    const counts: DrillReport['counts'] = {};
    for (const [t, expected] of Object.entries(manifest.counts)) {
      counts[t] = { expected, restored: restored.counts[t] ?? -1 };
      if (counts[t].restored !== expected)
        problems.push(`row count of ${t}: ${counts[t].restored} instead of ${expected}`);
    }
    if (restored.schemaVersion !== manifest.schemaVersion)
      problems.push(`schema version ${restored.schemaVersion} instead of ${manifest.schemaVersion}`);
    for (const [rule, n] of Object.entries(restored.consistency))
      if (n !== 0) problems.push(`consistency rule ${rule}: ${n} violations`);

    // Media: every file as recorded, and both files of every image row present.
    const work = await mkdtemp(join(tmpdir(), 'ers-restore-media-'));
    const checksumMismatches: string[] = [];
    const missingForRows: string[] = [];
    try {
      await cp(join(opts.backupDir, 'media'), work, { recursive: true });
      const now = await hashes(join(work, 'images'));
      for (const [path, sum] of Object.entries(manifest.media.sha256))
        if (now.sha256[path] !== sum) checksumMismatches.push(path);
      const client = new pg.Client({ connectionString: target.toString() });
      await client.connect();
      try {
        const rows = await client.query<{ storage_key: string }>('SELECT storage_key FROM app.event_images');
        for (const { storage_key: k } of rows.rows)
          for (const f of [`${k.slice(0, 2)}/${k}.webp`, `${k.slice(0, 2)}/${k}-thumb.webp`])
            if (!now.sha256[f]) missingForRows.push(f);
      } finally {
        await client.end();
      }
    } finally {
      await rm(work, { recursive: true, force: true });
    }
    if (checksumMismatches.length)
      problems.push(`${checksumMismatches.length} media files differ from the manifest`);
    if (missingForRows.length)
      problems.push(`${missingForRows.length} media files are missing for image rows`);

    report = {
      ok: problems.length === 0,
      database: name,
      schemaVersion: { expected: manifest.schemaVersion, restored: restored.schemaVersion },
      counts,
      consistency: restored.consistency,
      media: { files: manifest.media.files, checksumMismatches, missingForRows },
      problems,
      dropped: false,
    };
  } finally {
    if (!opts.keep) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
  report.dropped = !opts.keep;
  return report;
}
