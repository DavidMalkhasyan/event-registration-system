# Release Candidate Report (K-725)

**Prompt 33, phase 11.** Prepared on 2026-10-13. No tag has been created, no release pull request opened, nothing merged into `main`, nothing deployed and nothing submitted. Each of those steps waits for the stakeholder's explicit authorization. Decisions: [PD-104](DECISION_LOG.md).

**Recommendation:** `dev` is a **release candidate for the assignment demonstration in its local configuration** (fake email provider, OpenStreetMap tiles under option A).

It is **not production-ready.** Real email delivery, a production tile provider, hosting and the organizer second-factor decision are still open; see the blockers below.

## Status by area

| Area | Status | Evidence |
|---|---|---|
| Participant map (K-714) | **Implemented and verified**; production use **awaits external configuration** | PR #35; tiles only through our identified, bounded caching proxy; browser tests with a local tile stand-in; one live tile fetched from OpenStreetMap (16:56:48). Needs `MAP_TILE_CONTACT`, and a provider with an agreement (option B or C) before real production use |
| Email (K-717, K-402) | **Implemented and verified with mocks**; **awaiting external configuration** | PRs #36 and #37. Resend provider, outcome classes, Svix-verified webhooks, bounces and complaints, all tested against a simulated provider. **Real delivery has not been tested:** there is no Resend account, verified domain, API key or webhook secret |
| Super Admin security (K-718) | **Implemented and verified**; the organizer second factor is **blocked by a stakeholder decision** | PR #38. TOTP (RFC 6238) is required for Super Admins in production, with secrets sealed under `ADMIN_TOTP_KEY` and each code usable once. A local test Super Admin exists in the development database; its password is stored only in the Git-ignored `var/`. [SECURITY_AUDIT.md](../security/SECURITY_AUDIT.md) |
| Media (K-719) | **Implemented and verified**; antivirus **deferred** (assessed as not required for this design) | PR #39. Orphan sweep with a dry run, 503 on a failing disk, a processing limit. [MEDIA_SECURITY.md](../security/MEDIA_SECURITY.md) |
| Deployment (K-720) | **Implemented and verified in CI**; **awaiting a hosting decision and authorization** | PR #40. Every CI run since has built the image and run the whole stack: PostgreSQL 18, migration, web, worker, Caddy with HTTPS, readiness, headers, the operator commands, a backup and a restore drill. Nothing is deployed. [DEPLOYMENT.md](../operations/DEPLOYMENT.md) |
| Backups and restore (K-721) | **Implemented and verified** | PR #40. The restore drill passed on the development data, in the tests, inside the production stack in CI, and in this report's upgrade check. [BACKUP_RESTORE.md](../operations/BACKUP_RESTORE.md) |
| Performance (K-723) | **Implemented and verified** | PR #42. Every target was met. A defect was found and fixed: the participant list was quadratic, and it stopped silently at 1,000 rows. [PERFORMANCE.md](../operations/PERFORMANCE.md) |
| CI (K-724) | **Implemented and verified** | PR #41. Supported action versions on Node.js 24; no deprecation warning remains |
| End-to-end audit (K-722) | **Implemented and verified**; physical camera scanning, Safari and Firefox **not verified** | PR #43. Scenarios A to G and 48 page and width combinations pass, and two tablet layout defects were fixed. [E2E_AUDIT.md](E2E_AUDIT.md) |

## 1. Pull requests and merge commits (prompt 33, all into `dev`)

| PR | Content | Merge commit |
|---|---|---|
| [#35](https://github.com/DavidMalkhasyan/event-registration-system/pull/35) | Participant map (K-714) | `54cabba` |
| [#36](https://github.com/DavidMalkhasyan/event-registration-system/pull/36) | Resend email provider (K-717) | `1cd5136` |
| [#37](https://github.com/DavidMalkhasyan/event-registration-system/pull/37) | Delivery webhooks (K-402) | `cf3df9a` |
| [#38](https://github.com/DavidMalkhasyan/event-registration-system/pull/38) | Security audit; Super Admin TOTP (K-718) | `52dcdac` |
| [#39](https://github.com/DavidMalkhasyan/event-registration-system/pull/39) | Media reliability (K-719) | `83bd8c9` |
| [#40](https://github.com/DavidMalkhasyan/event-registration-system/pull/40) | Deployment stack; backups and restore drill (K-720, K-721) | `7be0f9f` |
| [#41](https://github.com/DavidMalkhasyan/event-registration-system/pull/41) | CI action versions (K-724) | `a3210ad` |
| [#42](https://github.com/DavidMalkhasyan/event-registration-system/pull/42) | Load measurements; paged participant list (K-723) | `87ab66b` |
| [#43](https://github.com/DavidMalkhasyan/event-registration-system/pull/43) | End-to-end and device audit; tablet fixes (K-722) | `19692bf` |
| [#44](https://github.com/DavidMalkhasyan/event-registration-system/pull/44) | This report and the documentation (K-725) | `d2b16f3` |

## 2. CI runs (each passed)

[#35](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38402954159), [#36](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38405245416), [#37](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38407621362), [#38](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38410473159), [#39](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38413452457) (`verify`). For #40 onwards, both `verify` and `container` passed: [#40](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38430267841) (after one fix: the first run's `container` job failed on a CI script error, [run 38428744973](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38428744973)), [#41](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38431597097), [#42](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38435274459), [#43](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38441517517).

## 3. Branches

When this report was written: `dev` `19692bf`; the report itself was merged as `d2b16f3` (CI [run 38445465510](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38445465510)), followed by a records-only pull request. `main` `8e7f6c1` (v1.0.0, unchanged). From `main` to `dev`: 90 commits (24 merges), 196 files, 20,798 lines added and 649 removed, schema 7 → 17.

## 4. Database migrations

- **Added since v1.0.0:** `0008_organizer_cancellation` to `0017_admin_totp`, ten files, forward-only. Files `0001` to `0007` are unchanged.
- **Added in prompt 33:** `0016_provider_events` (webhook events and delivery facts) and `0017_admin_totp` (sealed Super Admin TOTP secrets and the last step used).
- [POST_RELEASE_SCHEMA.md](../database/POST_RELEASE_SCHEMA.md) describes each one.

## 5. Tests

| Suite | Count | Result |
|---|---|---|
| Server integration tests (real PostgreSQL) | 249 in 32 files | 249/249, locally (with the restore drill test) and in CI |
| Client unit tests | 39 in 10 files | 39/39 |
| Browser tests (real web and worker processes) | 51 in 28 specs | 51/51 (Edge locally, Chromium in CI) |

Mutation checks were run for each new security or consistency rule in prompt 33. Each removed rule made a test fail.

## 6 to 10. Area statuses

The table at the top gives each area's status and evidence, with links to its document.

## 11. Backup and restore results

- **Development data:** schema 17 and every count matched; all 7 consistency rules were 0; the drill database was dropped; the source was unchanged.
- **Automated test:** a backup with registrations, a waiting list, a ticket, a check-in, a staff invitation and an image restored exactly. A damaged media file was detected.
- **CI:** inside the production stack, the drill returned `"ok": true` and the drill database was dropped.

## 12. Performance

The main figures, with 600 or 2,000 participants on one laptop:

| Path | p95 |
|---|---|
| Public page | 29 to 32 ms |
| Registration | 208 to 228 ms |
| Verification, everyone confirming at once | 368 to 404 ms |
| Last seat (50 at once) | 265 to 429 ms, exactly one seat |
| 50 cancellations with promotion | 653 to 737 ms; every promotion email within 1.9 s |
| Check-in | 89 to 92 ms |
| Live count reaching 200 open screens | 329 to 334 ms |

Across 7,625 and 10,425 timed requests: 0 errors, 0 rollbacks and 0 deadlocks. Full tables are in [PERFORMANCE.md](../operations/PERFORMANCE.md).

## 13. End-to-end findings

Three product defects were found and fixed:

- **The participant list:** quadratic, and silently truncated at 1,000 rows (PR #42).
- **The participant tables on tablets:** actions off-screen and email addresses broken letter by letter (PR #43).
- **The section tabs on tablets and phones:** cut off at the screen's edge (PR #43).

Behaviour confirmed as designed and the items not verified are listed in [E2E_AUDIT.md](E2E_AUDIT.md).

## Release-candidate verification (phase 11)

| Check | Result |
|---|---|
| `dev` is stable | Every pull request merged after green CI; the full local gates passed at 21:45 (249/249, 39/39, build, 51/51); the development database is unchanged (schema 17, the same counts before and after every migration run) |
| Migrations from a fresh database | An isolated database `ers_rc_fresh_0c042a9d` reached schema 17 with 17 migrations and 29 tables; a second run applied nothing; the database was dropped. CI does the same on every run |
| Upgrade from the released schema | See the next table |
| Production build and runtime | CI's `container` job builds the production image and runs it with `NODE_ENV=production` behind Caddy with HTTPS: readiness 200 and the operator commands work. `pnpm build` passes locally |
| Security headers | Checked through Caddy in CI (CSP `default-src 'self'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, no `Server` header), in `security-headers.test.ts`, and on link pages in audit scenario G |
| Media persistence | An image uploaded by one web-application instance was served byte for byte (`image/webp`) by a new instance using the same media directory. Backups carry the media with checksums |
| Final diff relative to `main` | Reviewed: 196 files. `REQUIREMENTS.md` is unchanged. No binary files. Every email address is on a reserved test domain. No key-like strings. `check:secrets` passes |

**Upgrade from the released schema, with isolated fixtures:**

1. The released code (`main`, v1.0.0, in a separate worktree) created schema 7 in an isolated database (`ers_rc_upgrade_20ad97c0`).
2. Using its own application code, it created an organizer and an event with capacity 2. Three participants registered; one cancelled, and the waiting participant was promoted. It also added a staff invitation and a check-in.
3. The development code then applied 0008 to 0017 in 303 ms. A second run applied nothing.
4. All 21 checks passed:
   - Every released row was kept: events, registrations by state, tickets, check-ins, staff invitations, access tokens, outbox and audit.
   - The released organizer became a verified account that owns an active organization, which owns the event.
   - All 7 consistency rules were 0.
   - With the new code, the organizer signs in and sees the event and the participants in the right states.
   - A management link from a released email still works.
   - The released check-in is respected ("already checked in").
   - The organization can create new events.
5. The database was dropped.

## 14. Blockers

Each blocker needs a stakeholder decision, an account or authorization. None can be resolved by the development process alone.

| # | Blocker | Needed for |
|---|---|---|
| 1 | A **Resend account**, a **verified sending domain**, an **API key** and a **webhook signing secret** (possibly a paid plan; not created, as instructed) | Real email delivery and delivery facts in production |
| 2 | **`MAP_TILE_CONTACT`** (an operator contact for the tile User-Agent) for the demonstration, and a **production tile provider** with an agreement (option B or C) | The participant map, in the demonstration and in production |
| 3 | A decision on an **organizer second factor** (PD-99) | Organizer account hardening |
| 4 | A **hosting decision** (a server or provider, a domain) and **authorization to deploy** | A production deployment |
| 5 | **Approval of the release scope:** a release pull request into `main` and a tag | The release itself |
| 6 | A **camera-equipped phone** for physical QR scanning, and Safari and Firefox runs | Device verification beyond Chromium and the simulated camera |

## 15. Recommendation

- **For the assignment demonstration:** `dev` at `19692bf` (plus this report) is ready as a release candidate in its local configuration. Every independently executable phase of prompt 33 is implemented and verified, and every gate is green.
- **For production:** not yet. Real email, the map provider, hosting and the second-factor decision are open (blockers 1 to 4). Production readiness must not be claimed until they are resolved and the deployment has been rehearsed on the target host (`pnpm bench`, a backup and a restore drill there).
- **Next step for the stakeholder:** approve the release scope (blocker 5), or ask for changes. Only then would a release pull request into `main` be opened.
