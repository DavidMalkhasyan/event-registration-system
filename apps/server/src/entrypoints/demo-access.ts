import { ADMIN_EMAIL, ORGANIZER_EMAIL } from '../demo/accounts.js';
import { base32Encode, otpauthUri, stepAt, totpCode } from '../platform/totp.js';

// Local demo only (compose.demo.yaml, service `demo-access`, logging disabled): shows the demo sign-in
// details from the secrets volume. Reads environment variables only; touches no database.

const origin = process.env.PUBLIC_ORIGIN ?? 'http://localhost:3000';
const { DEMO_ORGANIZER_PASSWORD, DEMO_ADMIN_PASSWORD, DEMO_ADMIN_TOTP_SECRET } = process.env;
if (
  process.env.NODE_ENV === 'production' ||
  !DEMO_ORGANIZER_PASSWORD ||
  !DEMO_ADMIN_PASSWORD ||
  !DEMO_ADMIN_TOTP_SECRET
) {
  process.stderr.write('demo-access: not a demo environment, or the demo secrets are missing\n');
  process.exit(1);
}
const secret = Buffer.from(DEMO_ADMIN_TOTP_SECRET, 'hex');
const now = Date.now();
const left = 30 - (Math.floor(now / 1000) % 30);

process.stdout.write(
  `Organizer: ${origin}/organizer
Email:    ${ORGANIZER_EMAIL}
Password: ${DEMO_ORGANIZER_PASSWORD}

Super Admin: ${origin}/admin
Email:    ${ADMIN_EMAIL}
Password: ${DEMO_ADMIN_PASSWORD}
TOTP code: ${totpCode(secret, stepAt(now))}   (valid for about ${left} s; run this command again for a fresh one)
TOTP key:  ${base32Encode(secret)}
TOTP link: ${otpauthUri(secret, ADMIN_EMAIL)}

The second factor is already enrolled. To use an authenticator app instead of this command, add the TOTP
key (time-based, 6 digits, 30 s). A code works once: after signing in, wait for the next 30 s code.
Test mailbox: ${origin}/dev/mailbox
`,
);
