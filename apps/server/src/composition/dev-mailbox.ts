import type { FastifyInstance } from 'fastify';
import { readMailbox } from '../modules/messaging/fake-provider.js';

// Development-only view of the fake provider's mailbox (never registered in production).
// It plays the role of the recipients' inboxes, so the demo can follow emailed links.

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function registerDevMailbox(app: FastifyInstance, dir: string): void {
  app.get('/dev/mailbox', async (request, reply) => {
    const filter = String((request.query as { to?: string }).to ?? '').toLowerCase();
    const entries = readMailbox(dir).filter((e) => !filter || e.to.includes(filter));
    const rows = entries
      .map(
        (e) =>
          `<article><h3>${escapeHtml(e.subject)}</h3><p class="meta">To ${escapeHtml(e.to)} · ${escapeHtml(e.createdAt)}</p>${e.html}</article>`,
      )
      .join('\n');
    reply.type('text/html; charset=utf-8');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dev mailbox</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#1d2433}
article{border:1px solid #d6dbe4;border-radius:8px;padding:0.5rem 1rem;margin:1rem 0}.meta{color:#5b6475;font-size:0.9rem}
.note{background:#fff7e0;padding:0.75rem 1rem;border-radius:8px}</style></head><body>
<h1>Dev mailbox</h1><p class="note">Development only: emails accepted by the fake email provider. No real email is sent.</p>
<form><label>Filter by recipient <input name="to" value="${escapeHtml(filter)}"></label> <button>Filter</button></form>
${rows || '<p>No emails yet.</p>'}</body></html>`;
  });
}
