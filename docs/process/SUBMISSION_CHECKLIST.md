# Submission Checklist

**Status values:**

- **Done:** has evidence.
- **In progress:** started, but not complete.
- **Not started.**

Nothing is marked Done without evidence. A planned action is not Done.

**State described (updated 2026-10-14, S-21):** the release candidate in `dev` at `5f87fad`, proposed for `main` by the **draft** release pull request [PR #47](https://github.com/DavidMalkhasyan/event-registration-system/pull/47) (`dev` → `main`, opened by the owner on 2026-10-14 at 11:39:12 +04:00, **not merged**). `main` is unchanged at `8e7f6c1`: the v1.0.0 release ([PR #17](https://github.com/DavidMalkhasyan/event-registration-system/pull/17), `cf804e2`) plus its documentation synchronization (PR #19). No tag exists; nothing is deployed; the assignment has not been submitted. The checklist for the v1.0.0 release is kept unchanged in §7.

## 1. Assignment requirements

| # | Requirement | Status | Evidence or next step |
|---|---|---|---|
| 1 | GitHub repository containing the **working** project | **Done** for `dev`; **not yet in `main`** | https://github.com/DavidMalkhasyan/event-registration-system. The release candidate passed the full local gates on 2026-10-13 22:25–22:39 (§2.3) and CI on every pull request into `dev`, the last being PR #45 and PR #46 (documentation; run 38469173870, `verify` and `container`). PR #47's CI on `5f87fad`, [run 38529731040](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38529731040), **passed** (finished 2026-10-14 11:48:18 +04:00): `verify` (secret scan, dependency audit, format, lint, typecheck, 17 migrations and "schema is up to date", **249/249** server, **39/39** client, build, **51/51** browser tests) and `container`. `main` still holds v1.0.0 (§7); merging PR #47 needs the owner's authorization. |
| 2 | Exact AI model and development tools, with a short rationale | **Done** | [AI_USAGE.md](AI_USAGE.md) §1–3: Claude Code with Claude Opus 5.5 (`claude-opus-5-5`) in every session; the model is also recorded in each journal entry |
| 3 | Important prompts, decision logs, or a safely handled session export | **Done** | [AI_USAGE.md](AI_USAGE.md) §4 (prompts 1–36); [DECISION_LOG.md](DECISION_LOG.md) (PD-1 to PD-104); the transcript is not exported (PD-7). See §3 |
| 4 | Real incremental progress shown by Git commits and timestamped records | **Done** | Unrewritten history from `da80a85`; 44 merged pull requests into `dev` and two into `main` (#17, #19); journal sessions **S-01 to S-21** with times from Git, GitHub and the session transcript |
| 5 | Clear setup and deployment instructions | **Done**, with limits | [README.md](../../README.md) §1–5 and §8 ("Upgrading an existing setup"); deployment templates and runbooks in [docs/operations/](../operations/) ([DEPLOYMENT.md](../operations/DEPLOYMENT.md), [BACKUP_RESTORE.md](../operations/BACKUP_RESTORE.md)). Clean-clone verification was done for the v1.0.0 code (S-03, S-14), not repeated for the release candidate; for it, CI migrates an empty database on every run and the `container` job builds and runs the production stack. **Nothing is deployed** (hosting not decided) |
| 6 | Accurate description of the current state | **Done** | [RELEASE_CANDIDATE.md](RELEASE_CANDIDATE.md); [ASSIGNMENT_SCOPE.md](../../ASSIGNMENT_SCOPE.md) (release state and the email, deployment and performance rows corrected in S-21); README §8 |
| 7 | Incomplete work and recommended next improvements | **Done** | §6 below; README §8–9; ASSIGNMENT_SCOPE §3–5; RELEASE_CANDIDATE §14 (blockers) |
| 8 | Attribution for reused templates, generators or third-party solutions | **Done** | [AI_USAGE.md](AI_USAGE.md) §7: the v0 design, libraries, tools, ChatGPT as stated by the stakeholder. The v0 design's AI-generated photographs with unestablished rights were removed in S-16 (PD-79) |

## 2. The release candidate

### 2.1 Branches and pull request

| Item | Value |
|---|---|
| `dev` | `5f87fad` "fix(client): proxy media requests to backend in development" (2026-10-14 01:39:18 +04:00): one line in `apps/client/vite.config.ts` adding `/media` to the **development server's** proxy. It was committed directly to `dev`, not through a pull request, after the last local gates; its first CI run is PR #47's (passed). It has not been smoke-tested in this session. It does not change the production build or the server |
| Before it | `07b3d0b` (PR #46, session context files, documentation only); `d2b16f3` (PR #44, [RELEASE_CANDIDATE.md](RELEASE_CANDIDATE.md)); `19692bf` (PR #43, the last feature code) |
| `main` | `8e7f6c1` (v1.0.0 and PR #19) |
| `main` → `dev` | 98 commits (27 merges), 200 files, +21,323 / −656 lines (counted 2026-10-14 11:43) |
| Release pull request | [PR #47](https://github.com/DavidMalkhasyan/event-registration-system/pull/47), draft, open. Its own pre-merge list (in the description) is the owner's: this update covers its first item; the others (case #9 scenario traceability, the 24-hour reminder semantics, a local smoke test of the `/media` proxy, the final diff review) are **not done here** |

### 2.2 Database

- **17 forward-only migrations**, `0001` to `0017`; schema version 17. `0001` to `0007` were released in v1.0.0 and are unchanged; `0008` to `0017` were added afterwards ([POST_RELEASE_SCHEMA.md](../database/POST_RELEASE_SCHEMA.md)).
- From an empty database: CI on every run, and an isolated database in S-20 (17 migrations; a second run applied nothing).
- Upgrade from v1.0.0: the released code built schema 7 with its own fixtures; the candidate applied `0008` to `0017`; 21 of 21 checks passed (S-20, [RELEASE_CANDIDATE.md](RELEASE_CANDIDATE.md)).

### 2.3 Test evidence

| Suite | Tests | Last full local run | CI |
|---|---|---|---|
| Server integration tests (real PostgreSQL 18) | 249 in 32 files | **249/249** | every pull request into `dev`; 249/249 on PR #47 |
| Client unit tests | 39 in 10 files | **39/39** | every pull request into `dev`; 39/39 on PR #47 |
| Browser tests (real web and worker processes) | 51 in 28 specs | **51/51** (Microsoft Edge) | Chromium, every pull request into `dev`; 51/51 on PR #47 |
| Other gates | — | `check:secrets`, `check:deps`, `format:check`, `lint`, `typecheck`, `migrate` (schema 17; development data unchanged), `build`: exit 0 | plus the `container` job since PR #40 |

The last full local run was on 2026-10-13 from 22:25:30 to 22:39:38 +04:00 (journal S-20), on the code of `d2b16f3`. Since then only documentation (PR #46) and the one-line development proxy (`5f87fad`) have changed. Load measurements, the backup and restore drill, the security audit and the end-to-end and device audit are in [RELEASE_CANDIDATE.md](RELEASE_CANDIDATE.md) §5–13.

## 3. AI development records

| Record | Coverage |
|---|---|
| [AI_USAGE.md](AI_USAGE.md) | Environment, model and tools (§1); rationale (§2); safeguards (§3); prompts 1–36 (§4); AI errors caught (§5); data handling (§6); attribution (§7) |
| [DEVELOPMENT_JOURNAL.md](DEVELOPMENT_JOURNAL.md) | H-0 (design, before version control) and sessions S-01 to S-21, with real timestamps, commands, results and commit hashes |
| [DECISION_LOG.md](DECISION_LOG.md) | PD-1 to PD-104, and the open questions |
| [KANBAN.md](KANBAN.md) | Every card with its pull request and merge commit |
| [REQUIREMENT_AMENDMENTS.md](REQUIREMENT_AMENDMENTS.md) | Approved deviations A-1 to A-6; `REQUIREMENTS.md` itself is unchanged |
| [CLAUDE.md](../../CLAUDE.md), [ARCHITECTURE_INDEX.md](../ARCHITECTURE_INDEX.md), [PROJECT_SUMMARY.md](../PROJECT_SUMMARY.md) | Working rules and context for new AI sessions (PR #46) |

The session transcript is not published (PD-7).

## 4. Before every push

1. **Secret scan:** `pnpm check:secrets` (tracked files; also in CI since S-14). The result must be "No secrets found".
2. **No real `.env` file** is tracked; only `.env.example` with placeholders (added in `d6fec3a`). The secret scan fails on a tracked `.env`.
3. **No session export, transcript or local path** (`C:\Users\…`) appears in tracked files. Last checked in S-15 with `git grep`: none.
4. **Personal data:** only example addresses in documents and fixtures.
5. **`git status`** is clean, and the journal entry for the session is committed.

## 5. Final submission (M6)

- [x] Every row in §1 has evidence.
- [x] The release candidate is described in [RELEASE_CANDIDATE.md](RELEASE_CANDIDATE.md) and this checklist; submission-facing documents state the current state (S-21).
- [x] Full local gates passed on the release-candidate code (2026-10-13 22:25–22:39; §2.3).
- [x] **Release pull request `dev` → `main`:** [PR #47](https://github.com/DavidMalkhasyan/event-registration-system/pull/47) opened as a draft by the owner (2026-10-14 11:39:12 +04:00).
- [x] **CI green on PR #47** (`verify` and `container`): [run 38529731040](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38529731040) on `5f87fad` ("No secrets found in 287 tracked files"; "No known vulnerabilities found").
- [ ] **The rest of PR #47's pre-merge list** (§2.1): the owner's review.
- [ ] **Merge of PR #47 into `main`:** needs the owner's explicit authorization; not done.
- [ ] **Release tag** (optional; the owner decides): not created.
- [ ] **Submission** of the assignment: the owner's action; **pending**.

## 6. Known limitations to state with the submission

- **Not production-ready:** nothing is deployed. The deployment templates (Docker Compose, Caddy with HTTPS), backups with a restore drill and load measurements are verified in CI and locally, but hosting, real email, a production map provider and the organizer second factor are open ([RELEASE_CANDIDATE.md](RELEASE_CANDIDATE.md) §14).
- **Email:** the local and demonstration configuration uses the fake provider. Resend and its delivery webhooks are implemented and tested only against a simulated provider; **no real email has been sent** (no account, verified domain, API key or webhook secret).
- **Map:** the participant map needs `MAP_TILE_CONTACT`; OpenStreetMap's tiles (option A) suit development and demonstrations only. A production provider (option B or C, PD-96) is not chosen.
- **Organizer second factor:** Super Admins have TOTP (required in production); organizers do not, pending a decision (PD-99).
- **Camera scanning:** tested with simulated camera and `BarcodeDetector` APIs (PD-74); never tried on a phone or with a real camera (accepted, PD-79). Manual code entry always works.
- **Browsers and platforms:** Chromium only (Edge locally, Chromium in CI); Safari and Firefox not tried; phone and tablet sizes emulated. Local setup verified on Windows and in CI on Ubuntu, not on macOS.
- **Not built:** email-address change (FR-ORG-6), link revocation lists, localization (English only, OQ-8), the email delivery budget and pausing, Redis.
- **Development server:** the Vite development server does not send the production page headers and injects its own client script; the production path is the tested one (PD-71, PD-72).
- **Accepted design limitations:** browser history may keep a link's fragment (EC-97); email gateways may rewrite links (EC-98); AC-186 (c) (closure of a staff stream within 30 s without check-ins) has no automated test.
- **Test infrastructure:** a local PostgreSQL test database instead of Testcontainers (no container runtime on the development machine).

## 7. History: the v1.0.0 release checklist (S-16)

The text below is the checklist as it stood after the v1.0.0 release and its documentation synchronization; only its section numbers and their cross-references were changed. It describes `main` and is not updated.

**State described:** the v1.0.0 release in `main` (`cf804e2`, [PR #17](https://github.com/DavidMalkhasyan/event-registration-system/pull/17), merged 2026-10-12 18:38:40 +04:00), plus this post-release documentation synchronization, which goes into `dev` and then `main` so that both branches have the same content. The S-03 P0 release (`8c1247d`) is its first parent.

### 7.1 Assignment requirements (v1.0.0)

| # | Requirement | Status | Evidence or next step |
|---|---|---|---|
| 1 | GitHub repository containing the **working** project | **Done**: released to `main` | https://github.com/DavidMalkhasyan/event-registration-system. CI on the release commit `cf804e2` in `main`: [run 38264425015](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38264425015) (push) passed, with the same checks as the release pull request's run [38257707045](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38257707045). Earlier, on `dev`: [run 38253717986](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38253717986) (PR #15, merged as `bb6db50`), the same checks as for the last feature code in [run 38244890522](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38244890522) (PR #14, merged as `cf35cbd`): secret scan, dependency audit, format, lint, typecheck, 7 migrations on an empty database and a repeat run, **135/135** server integration tests, **11/11** client unit tests, build, **22/22** browser tests. Before the release, `main` (`8c1247d`) last passed CI in [run 38142498731](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38142498731). |
| 2 | Exact AI model and development tools, with a short rationale | **Done** | [AI_USAGE.md](AI_USAGE.md) §1–3 |
| 3 | Important prompts, decision logs, or a safely handled session export | **Done** | [AI_USAGE.md](AI_USAGE.md) §4 (prompts 1–21, the whole project); [DECISION_LOG.md](DECISION_LOG.md) (PD-1 to PD-79). The transcript is not exported (PD-7). |
| 4 | Real incremental progress shown by Git commits and timestamped records | **Done** | Unrewritten history from `da80a85`; 16 merged pull requests into `dev` and the release pull request #17 into `main`; journal sessions **S-01 to S-16** with times from Git and the session transcript |
| 5 | Clear setup and deployment instructions | **Done** | [README.md](../../README.md) §1–5. **Clean-clone verification repeated in S-14** (journal): a fresh clone and a newly initialized PostgreSQL 18 cluster; install, provisioning, 7 migrations and "schema is up to date", secret scan, format, lint, typecheck, 135/135 and 11/11, build, the production-like run (with the FR-LNK-8 headers checked) and 22/22 browser tests. The first clean clone was in S-03. No production deployment exists; it is out of scope (P2). |
| 6 | Accurate description of the current state | **Done** | [ASSIGNMENT_SCOPE.md](../../ASSIGNMENT_SCOPE.md) (audited in S-15); README §8 |
| 7 | Incomplete work and recommended next improvements | **Done** | README §8–9; ASSIGNMENT_SCOPE §3–5 |
| 8 | Attribution for reused templates, generators or third-party solutions | **Done** | [AI_USAGE.md](AI_USAGE.md) §7: the v0 design, libraries, tools, ChatGPT as stated by the stakeholder. The v0 design's AI-generated photographs, whose licence was not established, were removed and replaced by original CSS posters (S-16, PD-79) |

### 7.2 GitHub remote (done in S-03)

1. The owner created the empty, public repository `DavidMalkhasyan/event-registration-system`.
2. The §4 checks were run over the **whole history**: clean.
3. `git remote add origin https://github.com/DavidMalkhasyan/event-registration-system.git`
4. `git push -u origin main` at 17:03:42 +04:00. The remote `main` was verified as `c45ecaf`.
5. Recorded in journal S-03. Since S-05, work goes through feature branches and pull requests into `dev` (PD-29).

### 7.3 Final submission of v1.0.0 (M6)

- [x] Every row in §7.1 has evidence.
- [x] CI is green on the release-preparation pull request (#16, run 38257048688), the release pull request (#17, run 38257707045) and the release commit in `main` (run 38264425015).
- [x] The setup passes from a clean clone of the current code (S-14).
- [x] The README contains setup, run, a production-like run, current state, known limitations and incomplete work.
- [x] The journal covers every development session (S-01 to S-16), with real timestamps and commit hashes.
- [x] Secret scan and dependency audit are clean in CI run 38264425015 on `main` ("No secrets found in 176 tracked files"; "No known vulnerabilities found").
- [x] AI usage and attribution are up to date (S-16).
- [x] **K-004** (process documentation) approved by the stakeholder (S-16).
- [x] **AI-generated photographs with unestablished rights** removed from the application and the current tree; replaced by original CSS posters; the production build contains no image files (S-16, PD-79).
- [x] **Release pull request `dev` → `main`**: [PR #17](https://github.com/DavidMalkhasyan/event-registration-system/pull/17) opened (PD-79), CI passed (run 38257707045), merged with the stakeholder's authorization on 2026-10-12 at 18:38:40 +04:00 as `cf804e2` (PD-80); CI passed on `cf804e2` ([run 38264425015](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38264425015)).
- [ ] **Release tag `v1.0.0`** (optional; the owner decides): not created.
- [ ] **Submission** of the assignment: the owner's action; not done.

### 7.4 Known limitations stated for v1.0.0

- **Camera scanning:** tested with simulated camera and `BarcodeDetector` APIs (PD-74); never tried on a phone or with a real camera. The stakeholder accepted this as a documented limitation, not a release blocker (PD-79). Desktop Chromium on Windows and Linux has no `BarcodeDetector`, so the scan button appears only where the browser supports it; manual code entry always works.
- **Artwork:** event artwork is six original CSS posters. The v0 design's three AI-generated photographs (no recorded licence) were removed in S-16; they remain in earlier commits, because the history is not rewritten.
- **Email:** only the fake provider exists; no real email is sent (Resend, webhooks and bounce handling are P2, deferred).
- **Not built:** email-address change (FR-ORG-6), link revocation lists, localization (English only, OQ-8), delivery budget and pausing, production deployment, performance testing.
- **Development server:** the Vite development server does not send the production page headers and injects its own client script; the production path (the web process serving the build) is the tested one (PD-71, PD-72).
- **Accepted design limitations:** browser history may keep a link's fragment (EC-97); email gateways may rewrite links (EC-98); AC-186 (c) (closure of a staff stream within 30 s without check-ins) has no automated test.
