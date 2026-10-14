# Operational Runbook (K-720)

For the stack in [DEPLOYMENT.md](DEPLOYMENT.md). `C` stands for `docker compose -f deploy/compose.yaml --env-file deploy/.env.production`.

## Daily

| Check | How | Act when |
|---|---|---|
| Readiness | `curl -fs https://<domain>/readyz` | not `"ready": true` → see below |
| Email backlog | `oldestDueEmailSeconds` in `/readyz` | above 300 → worker or provider problem |
| Backups | the newest `ops:backup` directory and drill report | missing or failed → run them now |
| Disk | `df -h` for the volumes | above 80 % → media sweep, old backups offsite, more disk |

## Symptoms

| Symptom | Likely cause | Steps |
|---|---|---|
| `/readyz` 503, `database: unavailable` | PostgreSQL down or full | `C ps`, `C logs postgres`; free disk; `C restart postgres` |
| `/readyz` 503, schema mismatch | an upgrade without its migration | `C up -d migrate`; check `C logs migrate` |
| `/readyz` 503, `media: not writable` | volume full or permissions | free disk; the volume must be writable by the image's user |
| Emails not arriving | worker stopped; Resend key, domain or quota | `C logs worker`; organizers see "failed" or "delivery outcome unknown" per participant; attempts record the provider's error name; fix the configuration and restart the worker (refused messages retry until their horizon) |
| Uploads answer 503 `media_storage_unavailable` | disk full or failing | free disk; then `media:sweep` |
| Many 429 answers for everyone | `TRUST_PROXY_HOPS` not 1 behind Caddy (all clients share Caddy's address) | set it, restart web |
| Super Admin cannot sign in: `second_factor_required` | no second factor enrolled | `C exec web node apps/server/dist/entrypoints/admin.js totp --email …` |
| Super Admin lost their authenticator | | enrol a new secret with the same command (the old one stops working) |
| A Super Admin account must be stopped | | `… admin.js disable --email …` (ends its sessions) |
| Map shows "not available" | `MAP_TILE_CONTACT` unset, or the tile service blocks us | the address and directions still work; for production use a provider with an agreement (PD-96) |

## Routine commands

| Task | Command |
|---|---|
| Logs | `C logs -f --tail 200 web worker` |
| Backup | `C exec web node apps/server/dist/entrypoints/ops.js backup --out /data/backups/$(date +%F)` |
| Restore drill | `C exec -e RESTORE_ADMIN_URL=… web node apps/server/dist/entrypoints/ops.js restore-drill --from /data/backups/<name>` |
| Orphan image files | `C exec web node apps/server/dist/entrypoints/media-sweep.js` (dry run), then `--apply` |
| Super Admins | `admin.js create / totp / disable` as above |
| Upgrade, rollback, restore | [DEPLOYMENT.md](DEPLOYMENT.md), [BACKUP_RESTORE.md](BACKUP_RESTORE.md) |

## Incidents involving personal data

Stop the cause first (disable the affected Super Admin, revoke sessions by resetting passwords, block the address range at Caddy), keep the logs and audit records, and follow the organization's data-breach procedure (notification duties apply). Never copy backups or logs to personal devices.
