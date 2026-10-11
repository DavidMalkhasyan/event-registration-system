import { resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
export const E2E_PORT = 3100;
export const ORIGIN = `http://localhost:${E2E_PORT}`;
export const E2E_MAILBOX = resolve(REPO_ROOT, 'var/e2e-mailbox');
