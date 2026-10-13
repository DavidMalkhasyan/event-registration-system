# EventFlow — Project Summary

Synthesis of the project's history and current state, written 2026-10-14 from the repository records
(REQUIREMENTS.md, ASSIGNMENT_SCOPE.md, docs/process/*, Git and PR history) and the most recent session.
Earlier conversations are not available verbatim; where this summary is about them it relies on the
records (DEVELOPMENT_JOURNAL.md sessions S-01 to S-20, DECISION_LOG.md PD-1 to PD-104).
Tags: **[verified]** checked by tests, CI or direct inspection; **[decided]** recorded decision;
**[open]** proposal or blocker waiting for the stakeholder.

## 1. The assignment

Build an event registration system (REQUIREMENTS.md v1.7, stakeholder review rounds R1–R60):
organizers create and manage events; participants register by email only (no accounts) and verify
their address; capacity is enforced with a FIFO waiting list and automatic promotion; confirmed
participants get a ticket (unique code and QR); event-scoped staff check tickets in; the organizer sees
a live check-in count; transactional emails have retries and delivery tracking. Correctness under
concurrency (exactly one winner for the last seat, one check-in per ticket) is a core acceptance theme
(the [concurrency] acceptance criteria). Scope, priorities and evidence per requirement:
`ASSIGNMENT_SCOPE.md`. REQUIREMENTS.md is never edited; deviations are amendments A-1 to A-6
(`docs/process/REQUIREMENT_AMENDMENTS.md`).

## 2. Architecture (original and still current)

- **Modular monolith** in a pnpm monorepo: one Fastify server with domain modules, a separate worker
  process, a React client, PostgreSQL as the only infrastructure (ARCHITECTURE.md, MODULES.md, ADRs).
- **Consistency boundary = the event** (ADR-002): every seat, waiting-list, check-in and cancellation
  decision runs in one transaction under the event's lock, using database "decision time".
- **Transactional outbox:** emails are rows written in the same transaction as the state change and
  sent by the worker with retries, leases and idempotency keys; never sent inside a transaction.
- **Links instead of participant accounts:** single-purpose tokens (verify, manage, share, invite,
  sign-in), stored hashed in one table (ADR-012), carried in the URL fragment and sent in an
  `Authorization: Link` header (ADR-011); link pages never leak referrers or cache.
- **Same origin** for client, API, media and map tiles (ADR-013); strict CSP, no third-party requests
  from participant pages.
- **Errors** as RFC 9457 problem details with stable codes (ADR-017); reporting reads across modules
  read-only (ADR-021). Live counts use SSE fed by PostgreSQL LISTEN/NOTIFY.

**Changed after the v1.0.0 release [decided]:** organizations own events (ADR-022, A-3) with organizer
accounts, passwords and roles; a Super Admin role approves organizations; events gained location,
photographs and a map (A-4 to A-6); capacity can only grow (A-2); organizers may cancel one confirmed
registration (A-1).

## 3. Milestones

| When | Milestone |
|---|---|
| S-01–S-03 (to 2026-10-11) | Requirements finalized (R60), repository and process records, P0 scope implemented, CI on GitHub Actions, clean-clone verification |
| S-04–S-12 | P1 backend: cutoff job, capacity changes, editing, re-authentication, event cancellation and deletion, participant self-service, staff invitations, check-in undo, waiting-list removal (PRs #1–#10) |
| S-13–S-16 (2026-10-12) | UI redesign from an approved Vercel v0 design (PRs #11–#13), release hardening (#14), documentation audit (#15–#16); **v1.0.0 merged into `main`** (PR #17, schema 7). No tag |
| S-17–S-18 | Live public availability (#20), organizer settings, organizer cancellation, refresh (#21–#23) |
| S-19 (prompt 29, 2026-10-13) | Post-release roadmap: scroll fixes, increase-only capacity, organizations, accounts and passwords, Super Admin, location, images, gallery, several organizers, staff review (#24–#34) |
| S-20 (prompt 33, 2026-10-13) | Production readiness: map, Resend email, webhooks, security audit and TOTP, media reliability, deployment and backups, CI versions, performance, end-to-end audit, release-candidate report (#35–#45) |

## 4. Implemented features (all in `dev`) [verified]

- **Organizers and organizations:** organization registration with email verification and Super Admin
  approval; password sign-in (Argon2id), emailed sign-in link for older passwordless accounts, reset,
  re-authentication for destructive actions; roles owner/admin/member with invitations.
- **Super Admin:** created only by `pnpm admin:create`; approves, rejects, suspends organizations with
  audit and emails; TOTP second factor (`pnpm admin:totp`), required in production.
- **Events:** create, edit title/description, reschedule (emails participants), increase capacity,
  cancel (emails, invalidates tickets), delete eligible events; venue with address, coordinates,
  directions links, venue-change emails; cover and up to 8 gallery photos (re-encoded WebP).
- **Participants:** email-only registration, verification, confirmation or waiting list, ticket with
  QR, management page (cancel, resend, share link, link rotation), live public availability (15 s poll).
- **Waiting list:** FIFO promotion on any freed seat, owner removal of a waiting entry, owner
  cancellation of a confirmed registration; positions shown to participants and organizers.
- **Check-in:** owner and staff (event-scoped device sessions from emailed invitations), manual code
  or camera (BarcodeDetector), exactly-once admission, undo by the owner, live count via SSE.
- **Organizer workspace:** dashboard, sections (participants, waiting list, check-in, staff, photos,
  settings), auto-refresh without scroll jumps or lost edits, paged participant list (1,000 per page).
- **Email:** fake provider (files, `/dev/mailbox`) and Resend provider; Svix-verified webhooks record
  delivered, bounced and complained facts; organizers see failed or uncertain deliveries per participant.
- **Map:** confirmed participants see a Leaflet map whose tiles come through the server's identified,
  bounded, caching proxy to OpenStreetMap (off until `MAP_TILE_CONTACT` is set).
- **Operations:** `/healthz`, `/readyz`; Docker Compose stack with Caddy (HTTPS); `pnpm ops:backup` and
  `pnpm ops:restore-drill`; `pnpm media:sweep`; `pnpm bench`; runbook and environment reference.

## 5. Security model [verified]

- Sessions: `__Host-` cookies (organizer, staff, admin, pre-session), idle and absolute expiry,
  per-kind HMAC CSRF tokens plus exact Origin check on state changes (webhooks exempt, signed instead).
- Link tokens: random, hashed at rest, fragment transport, single-use where required, rotation,
  `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on link pages; never logged (checked
  against real web and worker logs in the audit, scenario G).
- Authorization by organization membership and role; staff sessions are limited to one event's
  check-in (403 on organizer APIs); cross-organization access answers 404.
- Rate limits per IP, address, account and resource (`platform/ratelimit.ts`); `TRUST_PROXY_HOPS`
  behind a proxy. Uploads checked by content, re-encoded, never served as originals.
- Strict CSP, `X-Frame-Options: DENY`, `nosniff`; secrets only in env files ignored by Git;
  `check:secrets` in CI. Details: docs/security/SECURITY_AUDIT.md, MEDIA_SECURITY.md.

## 6. Database [verified]

PostgreSQL 18, schema `app`, 17 forward-only migrations applied under an advisory lock with checksums;
owner role migrates, runtime role cannot change the schema. `main` (v1.0.0) = schema 7; `dev` =
schema 17 (0008 organizer cancellation, 0009 organizations, 0010 organizer accounts, 0011 platform
admins, 0012 location, 0013 images, 0014 invitations, 0015 staff self-end, 0016 provider events,
0017 admin TOTP). An upgrade from 7 to 17 was verified with fixtures created by the released code
itself (21/21 checks). Design: docs/database/*.

## 7. Branches and releases [verified, 2026-10-14]

- `main` = `8e7f6c1` (v1.0.0, released 2026-10-12, untouched since). No tags exist.
- `dev` = `26f0ce3` (after PR #45): the release candidate of prompt 33. 90+ commits ahead of `main`.
- Workflow: feature branch → PR into `dev` → local gates → GitHub CI (`verify`, `container`) → reviewed
  diff → merge commit. Merging into `main`, tagging and deploying need explicit authorization [decided].

## 8. Latest test results [verified, 2026-10-13 22:25–22:39 locally; CI run 38448638569]

Server integration tests 249/249 (32 files, real PostgreSQL, including the backup restore drill);
client unit tests 39/39 (10 files); browser tests 51/51 (28 specs; Edge locally, Chromium in CI),
including the end-to-end audit (scenarios A–G) and the device audit (16 pages × 1440/768/390 px).
Performance (one laptop, docs/operations/PERFORMANCE.md): all targets met, 0 errors in 7,625 and
10,425 timed requests, last seat exactly once under 50 concurrent confirmations.

## 9. Important decisions (see DECISION_LOG.md)

- PD-81 live availability by polling, not a push channel; PD-83/A-1 organizer cancellation; PD-87/A-2
  increase-only capacity; PD-88–PD-90 organizations, passwords, Super Admin; PD-91–PD-93 location and
  images; PD-94 several organizers; PD-96 map via proxy (option A for development and demonstration);
  PD-97/PD-98 Resend and webhooks; PD-99 Super Admin TOTP, organizer second factor left to the
  stakeholder; PD-100 no antivirus (re-encoding instead); PD-101 Docker Compose + Caddy, backups only
  trusted after a restore drill; PD-102 measured targets, paged participant list; PD-103 audit as
  repeatable tests, tablet layout fix; PD-104 release-candidate recommendation.

## 10. Known limitations

- Real email delivery and real webhooks never tested (no Resend account, domain, key or secret).
- OpenStreetMap community tiles are for development and demonstration only; the map is off without
  `MAP_TILE_CONTACT`.
- Nothing is deployed; no point-in-time recovery (daily backups recommended instead).
- Camera scanning verified only with a simulated camera; Safari and Firefox untested; devices emulated.
- Tests use a local PostgreSQL instead of Testcontainers; English only; participants cannot change
  their registration email.

## 11. Pending stakeholder decisions [open]

1. Resend account, verified sending domain, API key, webhook signing secret (possibly paid).
2. `MAP_TILE_CONTACT`, and a production tile provider with an agreement (PD-96 option B or C).
3. Whether organizers get a second factor (PD-99).
4. Hosting provider, domain and authorization to deploy.
5. Approval of the release scope: release PR `dev` → `main` and a tag.
6. A camera-equipped phone and Safari/Firefox runs for device verification.

## 12. Recommended next steps

- Stakeholder: decide items 1–5 above; nothing else blocks the demonstration release.
- If the release is approved: open the release PR `dev` → `main`, verify CI on it, merge, tag only if
  asked; update README and records.
- If email is configured: set the Resend variables, send to a test inbox the stakeholder controls,
  verify webhooks, then record real delivery.
- Before production: deploy with `deploy/` on the chosen host, run backup + restore drill and
  `pnpm bench` there, check `/readyz` monitoring and the runbook.
- Details and evidence: docs/process/RELEASE_CANDIDATE.md, E2E_AUDIT.md, docs/operations/*.
