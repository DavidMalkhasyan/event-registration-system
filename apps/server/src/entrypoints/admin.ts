import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import {
  BootstrapError,
  createPlatformAdmin,
  disablePlatformAdmin,
} from '../modules/platform-admin/bootstrap.js';
import { ConfigError, requireEnv } from '../platform/config.js';
import { createDatabase } from '../platform/db.js';

// Super Admin operator commands (K-710, PD-90). Run on the server, never exposed over HTTP:
//   pnpm admin:create --email <address> --name "<name>"   (asks for the password twice, without echo)
//   pnpm admin:disable --email <address>
// For scripted setups the password can come on standard input instead: one line, no prompt. It is
// never accepted as an argument (it would land in shell history and process lists) and never printed.

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) {
      rl.close();
      return line;
    }
    return '';
  }
  const ask = (prompt: string) =>
    new Promise<string>((resolvePromise) => {
      process.stdout.write(prompt);
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      let value = '';
      const onData = (chunk: Buffer) => {
        for (const ch of chunk.toString('utf8')) {
          if (ch === '\r' || ch === '\n') {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.off('data', onData);
            process.stdout.write('\n');
            return resolvePromise(value);
          }
          if (ch === '\u0003') process.exit(130); // Ctrl+C
          if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
          else value += ch;
        }
      };
      stdin.on('data', onData);
    });
  const first = await ask('Password (at least 12 characters): ');
  const second = await ask('Repeat the password: ');
  if (first !== second) throw new BootstrapError('the two passwords are not the same; nothing was changed');
  return first;
}

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: { email: { type: 'string' }, name: { type: 'string' } },
  strict: true,
});

try {
  const db = createDatabase(requireEnv('MIGRATION_DATABASE_URL'), 1);
  try {
    if (command === 'create') {
      if (!values.email || !values.name)
        throw new BootstrapError('usage: admin:create --email <address> --name "<name>"');
      const admin = await createPlatformAdmin(db, {
        email: values.email,
        name: values.name,
        password: await readPassword(),
      });
      process.stdout.write(`Super Admin ${admin.email} created. Sign in at /admin.\n`);
    } else if (command === 'disable') {
      if (!values.email) throw new BootstrapError('usage: admin:disable --email <address>');
      await disablePlatformAdmin(db, values.email);
      process.stdout.write(`Super Admin ${values.email} disabled; its sessions have ended.\n`);
    } else {
      throw new BootstrapError('commands: create, disable');
    }
  } finally {
    await db.destroy();
  }
} catch (error) {
  const known = error instanceof BootstrapError || error instanceof ConfigError;
  process.stderr.write(`${known ? (error as Error).message : 'failed: ' + (error as Error).message}\n`);
  process.exit(1);
}
