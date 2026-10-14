import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import {
  BootstrapError,
  createPlatformAdmin,
  disablePlatformAdmin,
  enrolTotp,
} from '../modules/platform-admin/bootstrap.js';
import { newTotpSecret, otpauthUri, base32Encode } from '../platform/totp.js';
import { ConfigError, requireEnv } from '../platform/config.js';
import { createDatabase } from '../platform/db.js';

// Super Admin operator commands (K-710, PD-90). Run on the server, never exposed over HTTP:
//   pnpm admin:create --email <address> --name "<name>"   (asks for the password twice, without echo)
//   pnpm admin:disable --email <address>
//   pnpm admin:totp --email <address>   (K-718: shows a new secret once, then asks for a code from the app)
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

/** One line: typed at the terminal, or the first line of standard input for scripts. */
async function readLine(prompt: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdin.isTTY ? process.stdout : undefined,
  });
  if (process.stdin.isTTY) process.stdout.write(prompt);
  for await (const line of rl) {
    rl.close();
    return line;
  }
  return '';
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
    } else if (command === 'totp') {
      if (!values.email) throw new BootstrapError('usage: admin:totp --email <address>');
      const secret = newTotpSecret();
      // Shown once, on the operator's own terminal, to add to the Super Admin's authenticator app.
      process.stdout.write(
        `Add this to the authenticator app of ${values.email}:
  ${otpauthUri(secret, values.email)}
  (or type the key ${base32Encode(secret)})
`,
      );
      const code = await readLine('Then enter the 6-digit code the app shows: ');
      await enrolTotp(db, process.env.ADMIN_TOTP_KEY, values.email, secret, code);
      process.stdout.write(`Second factor enrolled for ${values.email}.
`);
    } else {
      throw new BootstrapError('commands: create, disable, totp');
    }
  } finally {
    await db.destroy();
  }
} catch (error) {
  const known = error instanceof BootstrapError || error instanceof ConfigError;
  process.stderr.write(`${known ? (error as Error).message : 'failed: ' + (error as Error).message}\n`);
  process.exit(1);
}
