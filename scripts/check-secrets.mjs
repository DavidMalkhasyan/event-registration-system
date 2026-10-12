// Secret scan of every git-tracked file (K-105). No dependencies; run with `pnpm check:secrets`.
// Looks for high-signal credential formats and tracked environment files. A match prints the file,
// line and rule name only, never the matched value.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const RULES = [
  ['private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['OpenAI or Anthropic key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}/],
  ['Stripe live key', /\b[sr]k_live_[A-Za-z0-9]{16,}/],
  ['Resend API key', /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/],
  // A database URL with an inline password that is not a placeholder or a variable.
  [
    'database URL with password',
    /postgres(?:ql)?:\/\/[^:\s/@]+:(?![$<{])(?!(?:password|secret|change-?me|example|x+)@)[^@\s'"`]{8,}@/i,
  ],
];
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|eot|mp4|webm)$/i;

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const findings = [];
for (const file of files) {
  const name = file.split('/').pop();
  if (/^\.env(\..*)?$/.test(name) && name !== '.env.example')
    findings.push(`${file}: tracked environment file`);
  if (BINARY.test(file)) continue;
  let text;
  try {
    if (statSync(file).size > 2_000_000) continue;
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // deleted in the working tree
  }
  text.split('\n').forEach((line, i) => {
    for (const [rule, pattern] of RULES) if (pattern.test(line)) findings.push(`${file}:${i + 1}: ${rule}`);
  });
}
if (findings.length) {
  console.error(`Possible secrets in tracked files:\n${findings.join('\n')}`);
  process.exit(1);
}
console.log(`No secrets found in ${files.length} tracked files.`);
