# Development Journal

**Time zone:** all local times are UTC+04:00 (Windows time zone "Caucasus Standard Time"). Times come from `Get-Date`, `date` and Git commit metadata, read during the session. They are never reconstructed afterwards.

**Rules:** one entry per working session. Never edit a past entry except to append a dated correction. Nothing is recorded that didn't happen: no invented timestamps, commits, test results or tool usage.

**Entry template:** session ID · start and end (local) · milestone and cards · tools and model · significant prompt (summary) · decisions · files changed · tests and checks actually run, with results · commits · problems · next steps.

---

## H-0: Design phase (historical; before version control)

| Field | Record |
|---|---|
| Period | **2026-10-09 08:58:55 UTC to 2026-10-11**, according to the local Claude Code session transcript. No per-step timestamps are claimed, because only the transcript as a whole carries them. |
| Milestone | Before M0 |
| Tools and model | Claude Code 2.1.295 and 2.1.296 (VS Code extension); model `claude-opus-5-5` (every assistant message in the transcript) |
| Work | Requirements clarification and review rounds (Q1–Q10, R1–R59); Phase 1 architecture; database design; API design. See [DECISION_LOG.md](DECISION_LOG.md) §2. |
| Output | REQUIREMENTS.md v1.6, `docs/architecture`, `docs/adr`, `docs/database`, `docs/api` |
| Checks | Ad-hoc Python consistency checks after every document change (requirement IDs, numbering, cross-references, module acyclicity, constraint columns, migration-plan coverage, OpenAPI 3.1 validation). Results were reported in the conversation; the scripts aren't versioned yet (PD-6). |
| Commits | None: Git didn't exist. The output entered version control unchanged in `da80a85` (S-01). |

---

## S-01: R60, Git initialization, process documentation

| Field | Record |
|---|---|
| **Start** | 2026-10-11 13:35:00 +04:00 (first timestamped command of the session) |
| **End** | 2026-10-11 13:42:45 +04:00 (time of the closing journal update) |
| **Milestone and cards** | M0: K-001, K-002, K-003, K-004 (K-005 blocked) |
| **Tools and model** | Claude Code 2.1.296 (VS Code extension), model `claude-opus-5-5`; Git 2.55.0.windows.3; Python 3.12.10 with `openapi-spec-validator` 0.7.1 and PyYAML 6.0.2 (outside the repository) |
| **Significant prompt** | "Finalize R60 and synchronize documentation" and "Establish a transparent development process with Git, Kanban, milestones and real progress records", plus clarifications on link errors, the idempotency limitation, the §4.8 → §4.9 fix and the honest SSE guarantee. "Do not fabricate historical timestamps, Git commits, test results or AI tool usage." |

**Decisions:**
- PD-2 to PD-9 ([DECISION_LOG.md](DECISION_LOG.md) §3).
- R60 applied with the stakeholder's clarifications. In particular, the SSE guarantee excludes the check-then-send window, and idempotency explicitly ends when the event is deleted.

**Activity:**

| Local time | Activity | Result |
|---|---|---|
| 13:35:00 | Environment check | Git 2.55.0, no repository; global identity configured; `docker` not found; `gh` 2.101.0 present; Python 3.12.10 |
| 13:35 | Read model and version metadata from the session transcript | `claude-opus-5-5` (581 assistant messages); Claude Code 2.1.295 and 2.1.296; first entry 2026-10-09T08:58:55Z |
| 13:35 | Secret and personal-data scan of the 18 baseline files | No key, token or password patterns. Only the example addresses `bob@x.com`, `BOB@x.com`, `Bob@X.com`, `bob+1@x.com`. No local paths or transcript references. |
| 13:35:25 | `git init -b main`; commit of the unchanged baseline | Commit **`da80a85`**. Line-ending warnings because the system Git configuration has `core.autocrlf=true` (PD-5). |
| 13:36–13:38 | Applied R60 to REQUIREMENTS.md (v1.7) | See the checks below |
| 13:37–13:38 | Synchronized 11 documents for R60; regenerated the ERD and the API catalogue | See the checks below |
| 13:38:31 | Commit of R60 | Commit **`3fe9cb7`** (12 files, +78 / −49) |
| 13:39–13:42 | Wrote the six process documents | — |

**Checks run, and their results:**

| Check | Result |
|---|---|
| Requirement structure, after R60 | EC-1 to EC-104 and AC-1 to AC-186 with no gaps; no dangling IDs; every R reference has a decision-log row; no duplicates; 28 concurrency-tagged ACs match the coverage table; no stale "§4.8" or "whatever the internal category" wording; status unchanged |
| Database documents (`verify_db`) | 0 problems: 27 tables, 27 foreign keys, 203 definitions, migration-plan coverage including U-27, CK-70 and TR-17 |
| OpenAPI (`openapi-spec-validator` 0.7.1) and contract checks (`verify_api`) | **Valid OpenAPI 3.1**; 52 operations; 0 problems |
| Architecture checks (`verify_docs`) | Module graph acyclic; ADR statuses unchanged (7 approved, 14 proposed). Known false positive: `TX-R01` to `TX-R03` misread as requirement IDs R01 to R03. |
| Application tests | **None**: there is no application code yet |

**Files changed:**
- **`da80a85`:** the 18 baseline files, added unchanged.
- **`3fe9cb7`:** REQUIREMENTS.md, ADR-017, the ADR index, API_DESIGN.md, openapi.yaml, ARCHITECTURE.md, MODULES.md, and all five database documents.
- **`896c263`** (2026-10-11 13:42:33 +04:00): the six files in `docs/process/`.
- **Closing commit** (follows `896c263`): this journal's end time and commit list. Its own hash is recorded in session S-02, because a commit can't contain its own hash.

**Problems:**
1. **No container runtime.** Docker isn't installed, which affects the Testcontainers tests in M2 (decision PD-Q6).
2. **Line-ending warnings** until `.gitattributes` is added (PD-5, K-102).
3. **No GitHub remote.** It needs the owner's decision (K-005, PD-Q5).
4. **Unversioned check scripts:** the documentation checks are still outside the repository (PD-6, K-104).

**Next steps:**
1. Stakeholder review of K-001 and K-004.
2. Decide PD-Q1 to PD-Q6, ADR-018 and OQ-8 ([DECISION_LOG.md](DECISION_LOG.md) §4).
3. The owner creates the GitHub repository; then push (K-005).
4. Start K-102, project initialization.

**Commits in S-01:**

| Hash | Time (+04:00) | Message |
|---|---|---|
| `da80a85` | 2026-10-11 13:35:25 | docs: add requirements and design baseline |
| `3fe9cb7` | 2026-10-11 13:38:31 | docs: apply R60 API alignment (REQUIREMENTS v1.7) |
| `896c263` | 2026-10-11 13:42:33 | docs(process): add Kanban, milestones and progress records |
| *(closing commit)* | 13:42:45 or later | docs(process): record S-01 end time and commit hashes. The hash is recorded in S-02. |

**Session time:** 13:35:00 to 13:42:45 (+04:00).

---

## S-02: Implementation of the P0 scope

| Field | Record |
|---|---|
| **Start** | 2026-10-11 14:02:06 +04:00 (first command of the session, from the session transcript) |
| **End** | 2026-10-11, at the closing documentation commit listed below. Its own time comes from Git; the activity table ends at 16:44:37. |
| **Milestone and cards** | M1 to M6, re-planned as P0 / P1 / P2 by the stakeholder's final delivery strategy ([ASSIGNMENT_SCOPE.md](../../ASSIGNMENT_SCOPE.md)). Card moves are in [KANBAN.md](KANBAN.md). |
| **Tools and model** | Claude Code 2.1.296 (VS Code extension), model `claude-opus-5-5`. Node.js 24.21.0, pnpm 12.11.2, PostgreSQL 18.6 (portable binaries), Git 2.55.0, Microsoft Edge 155 (driven by Playwright 1.64.0), Python 3.12.10 (secret generation and transcript reading only). |
| **Significant prompts** | "We are starting implementation NOW" (5 calendar days remain; approved stack; vertical slices; real PostgreSQL; autonomy for routine decisions). Then "FINAL DELIVERY STRATEGY": P0 / P1 / P2, ASSIGNMENT_SCOPE.md, quality gates, no fabricated progress. |
| **Context management** | The conversation was summarized automatically once, at 16:30:37. Work continued from the summary and the files on disk. |

**Decisions:** PD-10 to PD-21 in [DECISION_LOG.md](DECISION_LOG.md) §3.

**Activity.** Times are read from the session transcript and from Git:

| Local time | Activity | Result |
|---|---|---|
| 14:02:06 | Environment check | No PostgreSQL, Docker or Node.js installed; network available |
| 14:02:25–14:03:39 | Downloaded and extracted portable Node.js 24.21.0 and PostgreSQL 18 into the user profile, outside the repository | Node.js zip checked against `SHASUMS256.txt`: **OK**. EDB publishes no checksum for the PostgreSQL zip; its SHA-256 was recorded (see AI_USAGE.md). |
| 14:03:57 | `initdb` (UTF-8, built-in C.UTF-8 locale, scram-sha-256) and `pg_ctl start` on port 54318 | "server started". The superuser password is stored in a file outside the repository. |
| 14:04–14:06 | pnpm via corepack; root workspace and hygiene files; server package | TypeScript 7.0 resolved by default; pinned 6.0.3 (PD-11). Approved the esbuild build script for pnpm 12. |
| 14:08:17 | Migration `0001_core.sql` written | — |
| 14:08:44 | Provisioned roles and databases with `scripts/provision-local-db.sql`; generated the git-ignored `.env` with random secrets | `.env` confirmed ignored by Git |
| 14:10–14:12 | Platform layer (configuration, transactions and locks, crypto, errors, time, migration runner) | `pnpm migrate`: "applied 0001_core.sql (206 ms)"; second run "schema is up to date". Missing `MIGRATION_DATABASE_URL` → the variable is named and the process exits 1 (AC-143). |
| 14:13–14:17:34 | Modules: rate limiting, HTTP plumbing, outbox, tokens, audit, identity, events, registrations, check-in, notifications, fake provider, dispatcher | — |
| 14:17:34–16:10:16 | **The transcript records no tool calls in this interval.** | — |
| 16:10–16:14 | Web app, dev mailbox, live hub (SSE), entry points, migration `0002_reminders.sql`, lifecycle (cancel, promote, reschedule), jobs | First server typecheck passed. Fixed: a claim sentinel ambiguity, and due-work queries that ignored the test clock. |
| 16:15:36 | First integration test file | **7/7 passed** |
| 16:15:59 | Three commits created together (PD-21) | `e9545fa`, `f458591`, `2a4f722` |
| 16:17:35 | All integration tests | **2 failed, 21 passed**: the live test raced (the check-in fired before the second stream opened), and the mailbox wasn't cleared between tests |
| 16:18:15 | Rerun after fixing test isolation and adding the SSE barrier | **1 failed, 22 passed**: a duplicate ticket email |
| 16:18:47–16:19:13 | Cause: resetting the test data deleted the fake provider's key directory. The provider now recreates it and writes the key before the mail. | **23/23 passed**; typecheck passed |
| 16:19:20 | Commit | `34c98ec` |
| 16:19–16:23 | React client: public and organizer entries, fragment token bootstrap, pages | Client typecheck, 3/3 unit tests and the build passed after one Vite configuration typing fix |
| 16:23:49–16:25:21 | Started web, worker and Vite dev servers; HTTP smoke test of the whole P0 flow through :5173 | First attempt found the worker writing to `apps/server/var/mailbox` (relative path); paths are now resolved from the repository root. Second attempt: **"SMOKE TEST PASSED"** |
| 16:26:06 | Commits | `885dfa9`, `cc5bcbc` |
| 16:26–16:30 | ESLint (typescript-eslint, react-hooks, platform layering rule) and Prettier | Layering rule proven with a temporary violating file (error reported, file deleted). eslint 0 problems; Prettier reformatted 39 files; tests 23/23 and 3/3 passed again; build passed. Commit `9b40caf`. |
| 16:30–16:32 | CI workflow (`postgres:18` service) and `.env.example` | The same root scripts run locally in CI order: all exit 0. Commit `d6fec3a`. |
| 16:33–16:39 | Playwright E2E package, launcher, 4 browser tests | **4/4 passed** with Edge on the first run, and in 2 further consecutive runs. Mutation check: replacing the client's live-count handler made the two-device test fail (expected "1", received "0"); the change was reverted. Commit `b7a164f`. |
| 16:40–16:44 | Compiled build check; README, ASSIGNMENT_SCOPE.md, process documents | `node apps/server/dist/entrypoints/web.js` served `/healthz` (schema version 2), the organizer page (200) and its assets (200); the compiled worker started. Both were stopped afterwards. |

**Tests at the end of the session:**

| Suite | Result |
|---|---|
| Server integration tests (real PostgreSQL 18.6) | 23/23 passed |
| Client unit tests | 3/3 passed |
| Browser E2E (Playwright, Edge) | 4/4 passed |
| Lint, typecheck, format check, build | All pass |
| CI on GitHub | **Not run**: no remote exists (K-005) |

**Problems and open items:**
1. **No GitHub remote:** K-005 remains blocked on the owner.
2. **Setup unverified elsewhere:** the README setup hasn't been followed from a clean clone on another machine.
3. **Deferred P1/P2 scope:** see [ASSIGNMENT_SCOPE.md](../../ASSIGNMENT_SCOPE.md) §3.
4. **Shared commit time:** three commits share one timestamp (PD-21).

**Commits in S-02:**

| Hash | Time (+04:00) | Message |
|---|---|---|
| `8465c5d` | 2026-10-11 13:42:45 | docs(process): record S-01 end time and commit hashes. This is S-01's closing commit, recorded here as promised. |
| `e9545fa` | 16:15:59 | chore: initialize pnpm workspace and server toolchain |
| `f458591` | 16:15:59 | feat(db): add PostgreSQL migrations and migration runner |
| `2a4f722` | 16:15:59 | feat(server): organizer sign-in, events, registration, check-in, email worker |
| `34c98ec` | 16:19:21 | test(server): integration tests for the P0 flows; fix fake-provider ordering |
| `885dfa9` | 16:26:07 | feat(server): share view API; resolve local paths from the repository root |
| `cc5bcbc` | 16:26:07 | feat(client): React frontend for organizers and participants |
| `9b40caf` | 16:30:44 | chore: add ESLint and Prettier quality gates |
| `d6fec3a` | 16:32:12 | ci: GitHub Actions workflow with a PostgreSQL 18 service; add .env.example |
| `b7a164f` | 16:40:02 | test(e2e): Playwright browser tests, including two simultaneous clients |
| *(closing commit)* | after 16:44:37 | docs: README, assignment scope and S-02 process records. The hash is recorded in the next session. |

**Next steps:**
1. The owner creates the GitHub repository; then run the secret scan, push, and confirm the first CI run (K-005, K-103).
2. Follow the README from a clean clone.
3. Highest-priority remaining work: the P1 cutoff job, then event cancellation and capacity changes.

---

## S-03: Publishing, first CI runs, clean-clone verification

| Field | Record |
|---|---|
| **Start** | 2026-10-11 17:03:05 +04:00 (first command after the stakeholder's submission-validation prompt) |
| **End** | 2026-10-11, at the closing documentation commit listed below. The activity table ends at 17:14:42. |
| **Cards** | K-005, K-103, K-601, K-603 |
| **Tools and model** | Claude Code 2.1.296, model `claude-opus-5-5`; Git 2.55.0; GitHub CLI 2.101.0 (authenticated as the repository owner); the S-02 toolchain |
| **Significant prompt** | "Final submission validation": publish to the given repository, inspect the real CI results, verify from a clean clone by following the README exactly, re-check the assignment evidence, no new features, no history rewriting. |

**Activity:**

| Local time | Activity | Result |
|---|---|---|
| 17:03:05 | Checked Git status, history and author identity | Clean tree; 14 commits on `main`. Author and committer on every commit: `David Malkhasyan <Malkhasyandavid2@gmail.com>`, the owner's address, which becomes public with the push (PD-4). |
| 17:03 | Secret scan of the **whole history** (every commit, not only HEAD) | The only sensitive-looking file ever tracked is `.env.example`. No private-key, cloud, provider or GitHub token patterns. None of the local `.env` secrets, database passwords or the PostgreSQL superuser password appear in any commit. No local paths or host names. |
| 17:03 | Checked the remote | `DavidMalkhasyan/event-registration-system`: **public**, empty |
| 17:03:34–17:03:42 | `git remote add origin …`; `git push -u origin main` | `origin/main` = `c45ecaf`; history pushed unchanged |
| 17:03:48 | First GitHub Actions run, [38141682841](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38141682841) | **Passed** in 1 min 37 s. Migrations applied to a PostgreSQL 18.6 service; server 23/23, client 3/3, E2E 4/4 (Chromium); format, lint, typecheck and build passed. Annotations (warnings, not failures): the v4 actions target the deprecated Node.js 20 runtime; the `ubuntu-latest` label moves to Ubuntu 26 on 2026-10-19. |
| 17:06:15 | Stopped the S-02 dev servers so the README's default ports were free | Ports 3000, 5173, 5432 and 3100 free |
| 17:06:20 | `git clone` of the published repository into a new, empty directory | Commit `c45ecaf`; no `.env`, `node_modules` or `var/` |
| 17:06:28 | README §2: `corepack enable`; `pnpm install` | Exit 0 in 3.3 s (pnpm's global package store was already populated; nothing came from the original working directory) |
| 17:06:43–17:06:50 | README §2.1, portable binaries: `initdb` with the README's flags on a **new** data directory; `pg_ctl … start` (default port 5432); provisioning script | PostgreSQL 18.6; roles `app_owner` and `app_runtime`; databases `ers_dev` and `ers_test`. **Gap found:** `psql` asks for the superuser password, which the README didn't say. |
| 17:07:01 | README §2.2–2.3: `cp .env.example .env`, placeholders replaced (secrets from the README's `node -e` command); `pnpm migrate` twice | "2 migration(s) applied", then "schema is up to date" |
| 17:07:12 | README §3: `pnpm dev:web`, `pnpm dev:worker`, `pnpm dev:client` | `/healthz` through Vite: schema version 2; organizer page and `/dev/mailbox` return 200 |
| 17:08:01 | README §4 walkthrough in a browser (Edge, scripted, kept outside the repository), links taken from `/dev/mailbox` | Steps 1–7 passed. Step 8 failed because of **a bug in the verification script**: it took the already-used first sign-in email before the second had arrived. The script was fixed, not the application. |
| 17:09:00–17:09:12 | README §4 walkthrough, full rerun | **All 8 steps passed:** sign-in; event created; Anna confirmed with ticket and QR code, and the email contains the code; Ben waitlisted at position 1; the duplicate in upper case got an access email with the counts unchanged (1/1); cancellation promoted Ben, whose email contains his ticket code (counts 1/0); reschedule sent "Date changed"; a second device checked Ben in, the dashboard's live count went 0 → 1 without a reload, and a second scan showed "Already checked in". |
| 17:09:22–17:10:27 | README §5 in the clone: `pnpm test`, `lint`, `typecheck`, `format:check`, `build`, `PW_CHANNEL=msedge pnpm e2e` | All exit 0: 23/23, 3/3, 4/4. 20 emails in the clone's own `var/mailbox`. `git status` clean. |
| 17:10:52 | README §3 production-like run: `pnpm start:web` with `CLIENT_DIST_DIR` and `PUBLIC_ORIGIN=http://localhost:3000`, plus `pnpm start:worker` | Health, organizer page and asset all 200; a sign-in request (202) was delivered by the compiled worker. **Gap found:** the emailed link pointed to `localhost:5173`, because the README's worker command lacked `PUBLIC_ORIGIN`. |
| 17:11 | Restarted the worker with `PUBLIC_ORIGIN=http://localhost:3000` | Link origin :3000; the sign-in page loads (200); the link resolves (200) |
| 17:11:37 | Stopped the clone's processes and the verification cluster | No node processes left; ports free |
| 17:12:33 | README fixes committed and pushed | `67346ac` |
| 17:12:43 | Second GitHub Actions run, [38142263115](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38142263115) | **Passed** in 1 min 36 s: 23/23, 3/3, 4/4 |
| 17:13–17:14 | Checked ASSIGNMENT_SCOPE.md against the P0 list | Each of the 15 P0 rows cites tests that exist; all 20 cited test names were found in the test files. Statuses updated with CI and clean-clone evidence. Camera scanning is optional and stays "Implemented but unverified". |

**Not changed:** application code, tests, REQUIREMENTS.md and scope. Only the README and the process documents changed.

**Commits in S-03:**

| Hash | Time (+04:00) | Message |
|---|---|---|
| `c45ecaf` | 16:47:46 | docs: README, assignment scope and S-02 process records. S-02's closing commit, recorded here as promised. |
| `67346ac` | 17:12:33 | docs(readme): fix setup gaps found by the clean-clone verification |
| *(closing commit)* | after 17:14:42 | docs: record S-03 publishing, CI and clean-clone verification |

**Next steps:** submit the repository URL. Optional before submission: update the GitHub Actions versions to clear the Node.js 20 deprecation warning. P1 work only if time remains.

---

## S-04: K-404b Registration cutoff job

| Field | Record |
|---|---|
| **Start** | 2026-10-11 17:35:20 +04:00 (first command after the stakeholder's prompt) |
| **End** | 2026-10-11, at the closing documentation commit on the feature branch. The activity table ends at 17:44. |
| **Card** | K-404b (P1), on branch `feature/k-404b-cutoff-job` (PD-25) |
| **Tools and model** | Claude Code 2.1.296, model `claude-opus-5-5`; the S-02 toolchain |
| **Significant prompt** | "Continue development according to our EXISTING project plan … NEXT TASK: K-404b — Registration cutoff job." Read the task and its requirements first; inspect the transactions, jobs, waiting-list and notification code; work on a feature branch; integration and concurrency tests; run all checks and E2E; then name the next task, prioritizing K-304. No Redis or Kafka; no UI redesign. |
| **Before this session** | At about 17:26, on request, the development servers were started for manual inspection: web :3000, worker, Vite :5173, PostgreSQL :54318. No code changed, so there is no separate entry. |

**Sources read:**
- REQUIREMENTS.md: FR-WL-4 and FR-WL-5, FR-NTF-4, F8, AC-32, AC-106, AC-107, EC-18, EC-19, the state diagram (`EXPIRED` at the cutoff), the §4.9 row "Waiting list closed" (no links; key = registration + version), and NFR-REL-5.
- Design: TX-J03, TX-E04 (`params.waitlist_closed_by_change`), D-3 (`EXPIRED` only by the cutoff task or event cancellation), U-26.

**Activity:**

| Local time | Activity | Result |
|---|---|---|
| 17:35–17:37 | Read the requirements and design rows above; inspected `tasks.ts`, `lifecycle.ts`, `registrations.ts`, `handlers.ts`, the `0002` schema and the harness | The schema already allows `cutoff_processing` tasks with `params` and `EXPIRED (cutoff)`. No revoke reason exists for this case (PD-26). |
| 17:37:10 | `git switch -c feature/k-404b-cutoff-job` | `main` untouched |
| 17:37–17:38 | `scheduleCutoffTask` (create and reschedule); `runCutoff` (TX-J03, exclusive lock, attempt fence); `waitlist_closed` handler; migration `0003` backfill (PD-28) | — |
| 17:39:23 | Typecheck; new `cutoff.test.ts` | Typecheck passed. **3 passed, 1 failed:** the test expected the old version's task to be `SKIPPED` immediately, but it is correctly still `PENDING` until its own due time. The test was corrected to check that it skips itself when due. |
| 17:39:47 | `cutoff.test.ts` three times | 4/4, 4/4, 4/4 |
| 17:40:20 | Mutation checks, sources restored afterwards (byte-identical) | Ignoring the FR-NTF-4 flag → the AC-106 test fails. No `EXPIRED` update → all 4 fail. Freshness without the `WAITLISTED` check → the concurrency test fails (3 of 3 runs). |
| 17:40:56 | Side effect found: the running dev worker (`tsx watch`) reloaded the new code and refused to start, "schema version 2 does not match the expected version 3" (the intended fail-fast) | `pnpm migrate` on `ers_dev`: "applied 0003_cutoff_tasks.sql"; web and worker restarted; `/healthz` schema version 3 |
| 17:41:31–17:42:47 | Full suite: `format:check`, `lint`, `typecheck`, `test`, `build`, then `PW_CHANNEL=msedge pnpm e2e` | All exit 0. **Server 27/27** (23 existing + 4 new), client 3/3, **E2E 4/4** |
| 17:43:00 | Commit | `d25d3dd` feat(jobs): registration cutoff job (K-404b) |
| 17:43–17:44 | Kanban (K-404b → Review; K-304 split into K-304a–d in To Do), decisions PD-25 to PD-28, ASSIGNMENT_SCOPE, README | — |

**Test coverage added** (`apps/server/test/cutoff.test.ts`, real PostgreSQL):
1. **AC-32 and D-3.** Nothing happens before the cutoff. After it, two workers run the task in parallel. Each waiting participant gets exactly one email, and the confirmed participant none. The pending registration becomes `EXPIRED (cutoff)`, and its verification link gives the generic response. Re-running changes nothing.
2. **Concurrency at the cutoff.** These all start at once: three workers, a confirmed participant's cancellation, a waiting participant's cancellation, and a late verification. Results:
   - the late verification is rejected;
   - nobody is promoted;
   - the participant who left the list is never told it closed, whichever transaction commits first;
   - the remaining waiting participant gets exactly one email.
3. **FR-NTF-4 and AC-106.** A reschedule to inside the cutoff produces the change email stating "closed", and no separate email. The old version's task skips itself when due.
4. **EC-18, AC-107 and FR-REG-9.** After the cutoff, a reschedule to later reopens registration:
   - positions are kept, FIFO promotion resumes, and there is no "reopened" email;
   - the expired registrant can register again;
   - the new version's cutoff sends one more email (one per version).

**Not done:** CI has not run on this branch. The workflow runs on pushes to `main` and on pull requests, and the branch has not been pushed (PD-25).

**Commits in S-04:**

| Hash | Time (+04:00) | Message |
|---|---|---|
| `8c1247d` | 17:16:02 | docs: record S-03 publishing, CI and clean-clone verification. S-03's closing commit, recorded here. |
| `d25d3dd` | 17:43:00 | feat(jobs): registration cutoff job (K-404b) |
| *(closing commit)* | after 17:44 | docs: record K-404b in the journal, Kanban, decisions and scope |

**Next task:** K-304a, capacity change (FR-EVT-7, FR-EVT-8, TX-E03). K-304c, event cancellation, needs a decision first, because it requires recent authentication (FR-ORG-5), which is not implemented.

---

## S-05: Branching strategy, K-404b integration, K-304a capacity changes

| Field | Record |
|---|---|
| **Start** | 2026-10-11 17:48:49 +04:00 |
| **End** | 2026-10-11, at the closing documentation commit on `feature/k-304a-capacity`. The activity table ends at 18:00. |
| **Cards** | K-404b (Review → Done), K-304a (To Do → In Progress → Review) |
| **Tools and model** | Claude Code 2.1.296, model `claude-opus-5-5`; GitHub CLI 2.101.0; the S-02 toolchain |
| **Significant prompt** | The branching strategy (`main` stable, `dev` integration, `feature/*`, `fix/*`); publish K-404b as a pull request into `dev`, verify the real CI, review the diff, merge into `dev` (not `main`); no database downgrade or old code against schema 3; then K-304a with integration, concurrency and browser tests and a pull request into `dev`; report the re-authentication need before K-304c. |

**Activity:**

| Local time | Activity | Result |
|---|---|---|
| 17:48:49 | Inspected branches, remotes, history | `origin/main` = `8c1247d`, the verified submission (CI run 38142498731 passed); no `dev` branch; the feature branch sits directly on `main` |
| 17:48:59 | `git branch dev origin/main` (no checkout, so the working tree and the schema-3 dev servers never ran `main`'s code, PD-30); pushed `dev` and `feature/k-404b-cutoff-job` | `dev` → `origin/dev`; feature commits `d25d3dd` and `2d78ca5` unchanged |
| 17:49:17 | [PR #1](https://github.com/DavidMalkhasyan/event-registration-system/pull/1), `dev` ← `feature/k-404b-cutoff-job` | CI run 38144704826 started (`pull_request` event) |
| 17:49:43 | PR diff review | 12 files, +494 / −32; only server source, tests, migrations, process docs, README, ASSIGNMENT_SCOPE. No secrets: the pattern scan, plus a search for every local `.env` value and the superuser password. |
| 17:50–17:51 | CI [run 38144704826](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38144704826) | **Passed** in 1 min 40 s: migrations 0001–0003 on a fresh PostgreSQL; server 27/27, client 3/3, E2E 4/4 |
| 17:51:34 | `gh pr merge 1 --merge` | Merge commit `5818fb4` on `dev`; tree identical to the feature branch; `main` unchanged at `8c1247d` |
| 17:51:47 | `feature/k-304a-capacity` from `origin/dev` (upstream unset) | Dev servers unaffected (identical tree); `/healthz` schema 3 |
| 17:52:53 | Commit | `1474aa5` docs(process): branching strategy (PD-29, PD-30); K-404b Done |
| 17:51–17:53 | Read FR-EVT-7, FR-EVT-8, BR-1, BR-5, BR-11, AC-13 to AC-15, TX-E03, the API design (`setCapacity`, `PUT /api/events/{eventId}/capacity`, absolute value, `capacity_below_confirmed` with `minimumCapacity`) and FR-DSH-1 to FR-DSH-3 | Only the checked-in count is pushed live (FR-DSH-2); the other counts come from committed state on load and after the change (FR-DSH-3). No new live channel was added. |
| 17:53–17:54 | `setCapacity` (exclusive event lock, reuses `promoteFifo` and audit) and the route | Typecheck passed |
| 17:54:41 | `capacity.test.ts` (8 tests) | **8/8** on the first run |
| 17:55:12 | Mutation checks, source restored afterwards | No promotion → 4 tests fail; no minimum check → 3 fail; no no-op on repeats → 1 fails |
| 17:55:44 | Stability | 8/8 three times |
| 17:56:26 | Commit | `f6024e3` feat(events): capacity changes with FIFO promotion |
| 17:56–17:57 | "Capacity" card in the organizer UI; `capacity.spec.ts` E2E | Client typecheck and lint pass |
| 17:57:15–17:58:47 | Full suite | `format:check`, `lint`, `typecheck`, `test` (**server 35/35**, client 3/3), `build` all exit 0; **E2E 5/5**, twice |
| 17:59:19 | Commit | `c4f5733` feat(client): capacity control |
| 17:59 | Pushed the branch; [PR #2](https://github.com/DavidMalkhasyan/event-registration-system/pull/2), `dev` ← `feature/k-304a-capacity` | CI [run 38145423055](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38145423055) **passed** in 1 min 49 s: migrations 0001–0003; server 35/35, client 3/3, E2E 5/5 |

**Not done:** PR #2 is not merged; it awaits the stakeholder's review (PD-29). K-304a stays in Review until then.

**Commits in S-05:**

| Hash | Time (+04:00) | Message |
|---|---|---|
| `2d78ca5` | 17:44:46 | docs: record K-404b in the journal, Kanban, decisions and scope. S-04's closing commit. |
| `5818fb4` | 17:51:33 (GitHub) | Merge K-404b: registration cutoff job (#1) |
| `1474aa5` | 17:52:56 | docs(process): branching strategy; K-404b integrated into dev |
| `f6024e3` | 17:56:26 | feat(events): capacity changes with FIFO promotion (K-304a) |
| `c4f5733` | 17:59:19 | feat(client): capacity control on the event dashboard (K-304a) |
| *(closing commit)* | after 18:00 | docs: record K-304a. Pushed to PR #2, which triggers another CI run. |

**Next task:** K-304b, title and description edit (FR-EVT-5). Before K-304c, event cancellation, report the smallest compliant re-authentication mechanism (FR-EVT-9, FR-ORG-5); see the stakeholder's instruction.

---

## S-06: K-304a merged; K-304b title and description editing; K-304c assessment

| Field | Record |
|---|---|
| **Start** | 2026-10-11 18:27:07 +04:00 |
| **End** | 2026-10-11, at the closing documentation commit on `feature/k-304b-event-edit`. The activity table ends at 18:41. |
| **Cards** | K-304a (Review → Done), K-304b (To Do → Review), K-304c (assessment only) |
| **Tools and model** | Claude Code 2.1.296, model `claude-opus-5-5`; GitHub CLI 2.101.0; the S-02 toolchain |
| **Significant prompt** | "APPROVED — merge PR #2 into dev." Then K-304b following FR-EVT-5 and AC-105 on `feature/k-304b-event-edit`, with integration and browser tests and a pull request into `dev`, merged once green and reviewed. Then assess what FR-ORG-5 re-authentication needs for K-304c, and stop before implementing it. |

**Activity:**

| Local time | Activity | Result |
|---|---|---|
| 18:27:07 | Checked PR #2 | Head `3c73c23`, check `verify: SUCCESS`, mergeable, base `dev`; `origin/dev` `5818fb4`, `origin/main` `8c1247d` |
| 18:27:23 | `gh pr merge 2 --merge` | Merge commit `0a811bb` on `dev`; `dev` contains `d25d3dd` (K-404b) and `f6024e3` (K-304a); its tree equals the CI-tested PR head; `main` unchanged |
| 18:27:32 | `feature/k-304b-event-edit` from `origin/dev`, upstream unset | Working tree unchanged, so the dev servers kept running on schema 3 |
| 18:27–18:28 | Read FR-EVT-1, FR-EVT-5, AC-105, TX-E02 and `updateEventDetails` (`PATCH /api/events/{eventId}`, `EventDetailsPatch` with `additionalProperties: false` and `minProperties: 1`) | — |
| 18:28–18:29 | `updateEventDetails` and the route | First typecheck failed: audit `details` values must be scalars (an array was passed); fixed with a comma-joined string |
| 18:29:31 | `event-edit.test.ts` (6 tests) | **6/6** |
| 18:29:52 | Mutation checks, source restored | Without the status check, the owner check or the no-op, one test fails each time; 6/6 twice afterwards |
| 18:30:27 | Commit | `19ff849` feat(events): edit event title and description |
| 18:30–18:31 | "Event details" card in the UI; `event-edit.spec.ts` | Client typecheck and lint pass |
| 18:31:26–18:33:36 | Full suite | `format:check`, `lint`, `typecheck`, `test` (**server 41/41**, client 3/3) and `build` exit 0. **E2E failed twice with the same 2 failures, both in the tests:** (1) `event-edit`: the "before" email count was read before the asynchronous ticket email arrived (the extra email was the ticket, not an edit email); (2) `participant-flow`: `getByText('Created by the end-to-end test.')` now matched 2 elements, because the new editor's text area also holds the description. |
| 18:33:47–18:35:54 | Fixes: wait for the ticket email first; look for the description in the displayed paragraph | **E2E 6/6 three times** |
| 18:36:46 | Static checks again; commit | All exit 0. `b8ffae1` feat(client): edit event title and description on the dashboard |
| 18:36:59 | Pushed; [PR #3](https://github.com/DavidMalkhasyan/event-registration-system/pull/3), `dev` ← `feature/k-304b-event-edit` | CI [run 38147918146](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38147918146) **passed** in 2 min 4 s: 3 migrations; server 41/41, client 3/3, E2E 6/6 |
| 18:37–18:40 | K-304c assessment. Read: FR-ORG-4, FR-ORG-5, FR-EVT-9, AC-149, ADR-010 §8, API #27 `requestReauthentication`, TX-A01, TX-A02, CK-03, CK-05, CK-11, FK-20. Inspected `sign-in.ts`, `sessions.ts` and the identity routes. | The schema and the confirmation side already support re-authentication. The missing parts are listed in the report to the stakeholder; no implementation. |
| 18:40:28 | Kanban, scope, README, PD-31, AI usage, this entry | — |

**Commits in S-06:**

| Hash | Time (+04:00) | Message |
|---|---|---|
| `3c73c23` | 18:03:12 | docs: record K-304a … S-05's closing commit |
| `0a811bb` | 18:27:22 (GitHub) | Merge K-304a: event capacity changes (#2) |
| `19ff849` | 18:30:27 | feat(events): edit event title and description (K-304b) |
| `b8ffae1` | 18:36:46 | feat(client): edit event title and description on the dashboard (K-304b) |
| *(closing commit)* | after 18:41 | docs: record K-304b. Pushed to PR #3. |

**Next:** merge PR #3 into `dev` once the final CI run is green; record K-304b as Done at the start of the next branch. K-304c waits for the stakeholder's review of the re-authentication assessment.

---

## S-07: K-302b Re-authentication; K-304c plan

| Field | Record |
|---|---|
| **Start** | 2026-10-11 19:43:12 +04:00 |
| **End** | 2026-10-11, at the closing documentation commit on `feature/k-302-reauthentication`. The activity table ends at 20:05. |
| **Cards** | K-304b (Review → Done), K-302b (To Do → In Progress → Review), K-304c (plan only) |
| **Tools and model** | Claude Code 2.1.296, model `claude-opus-5-5`; GitHub CLI 2.101.0; the S-02 toolchain; `pg` 8.23.1 added to the E2E package |
| **Significant prompt** | "DECISION APPROVED — IMPLEMENT RE-AUTHENTICATION FIRST." Record K-304b as Done; implement K-302b (FR-ORG-5, AC-149, ADR-010) with a reusable recent-authentication helper used inside locked transactions, a minimal UI, and integration tests (boundary, race, second device, no action); a browser test using controlled test-database setup and no backdoors; a pull request into `dev`, merged when green. Then report the K-304c plan without implementing it. |

**Activity:**

| Local time | Activity | Result |
|---|---|---|
| 19:43:12 | `dev` synced (`a99c44d`); PR #3 confirmed merged, run 38148193367 `success`; `feature/k-302-reauthentication` from `origin/dev` | `main` unchanged at `8c1247d` |
| 19:43:34 | Commit | `c866ae0` docs(process): K-304b Done; K-302b in progress |
| 19:43–19:44 | Read the API #27 contract (`202 CheckYourEmail`, session and CSRF, no body), API_DESIGN §5 and §11, ADR-010 §8, TX-A01, TX-A02, and the identity code | Already in place: the schema (`purpose 'reauth'`, `reauth_session_id`, `authenticated_at`, `reauth_replaced`), the revocation in TX-A02, `RECENT_AUTH_MS`, `recentAuthUntil` and the `reauthentication_required` error code. **No migration needed.** |
| 19:44–19:45 | Shared TX-A01 insert; `requestReauthentication`; `reauthPerAccount` rate rule (PD-32); `recentAuthentication` and `requireRecentAuthentication` (PD-33); route; re-authentication email text | Typecheck and lint pass; existing server suite **41/41** after the refactor |
| 19:47:42 | `reauth.test.ts` (12 tests) | **12/12** on the first run |
| 19:48:13 | Mutation checks: no `FOR SHARE`, `<=` at the boundary, no revocation on confirm, no rate limit | Each fails at least one test. A test-robustness flaw showed up: with no `FOR SHARE`, the failing race test left its gated transaction open, stalling the next test for 60 s. |
| 19:53:50 | The race test releases its gate in `finally` | That mutation now fails cleanly in 8.8 s; 12/12 with the source restored |
| 19:55:51 | Server suite **53/53**; commit | `70eb8da` feat(identity): re-authentication for protected actions |
| 19:56–19:57 | UI: `ReauthPrompt`, the "Recent sign-in" card, the re-authentication variant of the link page, the return path (PD-34) | ESLint `react-hooks/purity` rejected `Date.now()` during render; replaced with lazy state refreshed every 30 s. Client unit tests 5/5 (2 new: return path, open redirect). |
| 19:57–19:58 | `apps/e2e/tests/db.ts` (test-database fixture, PD-35) and `reauth.spec.ts` | — |
| 19:58:07–20:01:55 | Full suite | `format:check`, `lint`, `typecheck`, `test` (**server 53/53, client 5/5**) and `build` exit 0; **E2E 7/7** three times. Commit `adde442`. |
| 20:02:09 | Pushed; [PR #4](https://github.com/DavidMalkhasyan/event-registration-system/pull/4), `dev` ← `feature/k-302-reauthentication` | CI [run 38153782544](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38153782544) **passed** in 2 min 7 s: 3 migrations; 53/53, 5/5, 7/7 |
| 20:02–20:03 | K-304c reading: BR-16, TX-E05, API #36 `cancelEvent` (`ConfirmedAction`, `x-recent-authentication`, state idempotency), §4.9 "Event cancellation", AC-18, AC-19, AC-59, EC-20, FR-LNK-6, FR-SHR-4, FR-STAFF-5; existing code paths | Plan and open decisions reported to the stakeholder; no implementation |

**Commits in S-07:**

| Hash | Time (+04:00) | Message |
|---|---|---|
| `c2280d1` | 18:41:08 | docs: record K-304b … S-06's closing commit |
| `a99c44d` | 18:43:41 (GitHub) | Merge K-304b: edit event title and description (#3) |
| `c866ae0` | 19:43:34 | docs(process): K-304b Done; K-302b re-authentication in progress |
| `70eb8da` | 19:55:51 | feat(identity): re-authentication for protected actions (K-302b) |
| `adde442` | 20:01:55 | feat(client): minimal re-authentication flow (K-302b) |
| *(closing commit)* | after 20:05 | docs: record K-302b. Pushed to PR #4. |

**Next:** merge PR #4 into `dev` once its final CI run is green; record K-302b as Done at the start of the next branch; K-304c after the stakeholder reviews its plan.

---

## S-08: K-304c Event cancellation

| Field | Record |
|---|---|
| **Start** | 2026-10-11 21:51:25 +04:00 |
| **End** | 2026-10-11, at the closing documentation commit on `feature/k-304c-event-cancellation`. The activity table ends at 22:10. |
| **Cards** | K-302b (Review → Done), K-304c (To Do → In Progress → Review), K-304d (readiness check) |
| **Tools and model** | Claude Code 2.1.296, model `claude-opus-5-5`; GitHub CLI 2.101.0; the S-02 toolchain |
| **Significant prompt** | "K-304c EVENT CANCELLATION — DECISIONS APPROVED", D1–D7 (PD-36 to PD-42). Implement per FR-EVT-9, FR-EVT-11, FR-ORG-5, BR-16, BR-18, BR-23, FR-LNK-6, FR-SHR-4, AC-18, AC-19, AC-59, AC-149 and TX-E05; 21 listed integration cases with deterministic concurrency; browser tests; a pull request into `dev`; then K-304d if its requirements are sufficiently resolved. |

**Activity:**

| Local time | Activity | Result |
|---|---|---|
| 21:51:25 | `feature/k-304c-event-cancellation` from `origin/dev` (`88399fd`); read BR-18, BR-23, FR-EVT-11, FR-STAFF-4 | — |
| 21:51–21:54 | Read the dispatcher (claim under the shared event lock; freshness → `DROPPED`, or `UNCONFIRMED` when possibly accepted; ambiguous failure → `WAITING_RETRY` with `possibly_accepted`), the check-in outcome order (`EVENT_CANCELLED` before the window check), and the management, share and verification paths | D1 holds on every link path: status and event status are re-checked, under the lock for actions |
| 21:53:02 | Commit | `b3379f5` docs(process): K-302b Done; decisions D1–D7; K-406 dependency |
| 21:53–21:54 | `cancelEvent` (TX-E05), `confirmedActionSchema`, `eventCancellationPerAccount` rule, route, `event_cancellation` handler; `reauthenticate` harness helper | Typecheck and lint pass |
| 21:56:13 | `cancellation.test.ts` (20 tests) | **19 passed, 1 failed.** The failure was in the test: it asserted `DROPPED` on every verification message, including those delivered during setup. The test was fixed to snapshot exactly the messages queued at cancellation time. |
| 21:56:50 | Rerun three times | 20/20, 20/20, 20/20 |
| 21:58:01 | Mutation checks | No recent-auth check → 2 tests fail; no idempotent short-circuit → 2 fail; no rate limit → 1 fails. "Change email without the status check" **survived**: its freshness also checks the schedule version, which cancellation bumps, so it was not a real weakening. |
| 21:59:19 | Stronger freshness mutations | Change email always fresh → 2 tests fail; registration messages always fresh → 4 fail. Sources restored. |
| 22:01:06 | Server suite **73/73**; commit | `7575432` feat(events): event cancellation (K-304c) |
| 22:01–22:02 | UI: "Cancel event" card, CANCELLED banners (organizer and public); `cancellation.spec.ts` | Client typecheck and lint pass |
| 22:02:27–22:06:36 | Full suite | `format:check`, `lint`, `typecheck`, `test` (server 73/73, client 5/5) and `build` exit 0; **E2E 9/9 three times**. Commit `44b453e`. |
| 22:06:53 | Pushed; [PR #5](https://github.com/DavidMalkhasyan/event-registration-system/pull/5), `dev` ← `feature/k-304c-event-cancellation` | CI [run 38162451724](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38162451724) **passed** in 2 min 27 s: 3 migrations; 73/73, 5/5, 9/9 |
| 22:07–22:10 | K-304d readiness check: FR-EVT-10, 13, 14, TX-E06, API #37 and #38, API_DESIGN §7.4, `deletion_markers`, BR-26, BR-29, AC-86 to AC-88, AC-97, AC-98, AC-100, AC-184 | Requirements and design are specified, and no open product or security decision was found. Implementation needs migration `0004`, the `K_preview` secret, and send-state-only counting (no provider facts without webhooks). |

**Concurrency results:**
- **AC-18 (claim vs. cancellation), forced with a gated provider:**
  - cancellation first: all 4 queued messages `DROPPED`;
  - claim first: both claimed change emails `ACCEPTED` (EC-20);
  - possibly accepted messages end `UNCONFIRMED`.
- **BR-23 (participant cancellation vs. event cancellation):** both orders forced, and 4 simultaneous rounds each produced exactly one of the two outcomes.
- **Other races, 4 rounds each:** verification, capacity increase, and two simultaneous cancellations; all invariants held.

**Commits in S-08:**

| Hash | Time (+04:00) | Message |
|---|---|---|
| `55943cc` | 20:06:18 | docs: record K-302b … S-07's closing commit |
| `88399fd` | 20:08:53 (GitHub) | Merge K-302b: re-authentication for protected actions (#4) |
| `b3379f5` | 21:53:02 | docs(process): K-302b Done; K-304c decisions D1–D7; K-406 dependency |
| `7575432` | 22:01:06 | feat(events): event cancellation (K-304c) |
| `44b453e` | 22:06:36 | feat(client): cancel an event from the dashboard (K-304c) |
| *(closing commit)* | after 22:10 | docs: record K-304c. Pushed to PR #5. |

---

## S-09: K-304c merged; K-304d Event deletion

| Field | Record |
|---|---|
| **Start** | 2026-10-11 22:12:00 +04:00 (continuation of the S-08 prompt: "After K-304c is successfully merged into dev, proceed with … K-304d … only if its documented requirements and dependencies are sufficiently resolved") |
| **End** | 2026-10-11, at the closing documentation commit on `feature/k-304d-event-deletion`. The activity table ends at 22:34. |
| **Cards** | K-304c (Review → Done), K-304d (To Do → In Progress → Review) |
| **Tools and model** | Claude Code 2.1.296, model `claude-opus-5-5`; GitHub CLI 2.101.0; the S-02 toolchain |

**Activity:**

| Local time | Activity | Result |
|---|---|---|
| 22:12:32 | K-304c documentation commit `754621c` pushed to PR #5; diff reviewed (15 files, no secrets, two replaced source lines) | — |
| 22:13–22:15 | Final PR #5 CI [run 38162851806](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38162851806) | **Passed**: 3 migrations; 73/73, 5/5, 9/9 |
| 22:15:17 | `gh pr merge 5 --merge` | Merge commit `fef8a81` on `dev`; tree equals the tested head; `main` unchanged |
| 22:15–22:16 | K-304d design read: §8.4 deletion order; foreign keys (events and registrations cascade; outbox, audit and tasks are soft references); `events_tr05` refuses deleting a cancelled event; `audit_records` append-only; Glossary "pending message" and "required notice"; `DeletionPreview`, `DeleteEventInput` and blocker enums; ADR-010 §7 `K_preview`; the horizon sweep | No open product or security decision (PD-43) |
| 22:16:47 | `feature/k-304d-event-deletion` from `origin/dev`; `PREVIEW_SECRET` appended to the local, git-ignored `.env` (random) | — |
| 22:17:15 | Commit | `13ba1eb` docs(process): K-304c Done; PD-43 to PD-46 |
| 22:17–22:18 | Migration `0004`, schema type, config secret (also `.env.example` and CI), four error codes, `deletion.ts`, routes | Typecheck and lint pass. While writing the module, the check order was corrected (PD-46): the token is verified against the *current* snapshot, so the cancelled-event check must come first. |
| 22:19:21 | `pnpm migrate` on `ers_dev` ("applied 0004_deletion_markers.sql"); web and worker restarted | `/healthz` schema version 4 |
| 22:21:14 | `deletion.test.ts` (10 tests) | **9 passed, 1 failed.** In the AC-184 test, the harness `signIn` drains the outbox and so delivered the freshly queued verification the test wanted to see dropped. The resubmission was moved after the sign-in. |
| 22:21:39 | Rerun three times | 10/10 each |
| 22:22:19 | Five mutation checks | No recent auth on delete → 1 fails; no cancelled check → 1; snapshot outside the MAC → 2; pending required notices ignored → 2; always `DROPPED` → 1. Source restored. |
| 22:24:22 | Server suite **83/83**; commit | `17d85f4` feat(events): event deletion with preview, marker and audit survival |
| 22:24–22:26 | "Delete event" card; one-time notice on the events list; `deletion.spec.ts` | Client typecheck and lint pass |
| 22:26:03–22:32:30 | Full suite | `format:check`, `lint`, `typecheck`, `test` (server 83/83, client 5/5) and `build` exit 0; **E2E 12/12 three times**. Commit `39f1159`. |
| 22:32:48 | Pushed; [PR #6](https://github.com/DavidMalkhasyan/event-registration-system/pull/6), `dev` ← `feature/k-304d-event-deletion` | CI [run 38164273828](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38164273828) **passed** in 2 min 26 s: **4 migrations** on a fresh database; 83/83, 5/5, 12/12 |

**Commits in S-09:**

| Hash | Time (+04:00) | Message |
|---|---|---|
| `754621c` | 22:12:32 | docs: record K-304c … S-08's closing commit |
| `fef8a81` | 22:15:17 (GitHub) | Merge K-304c: event cancellation (#5) |
| `13ba1eb` | 22:17:15 | docs(process): K-304c Done; K-304d started with decisions PD-43 to PD-46 |
| `17d85f4` | 22:24:22 | feat(events): event deletion with preview, marker and audit survival (K-304d) |
| `39f1159` | 22:32:30 | feat(client): delete an event from the dashboard (K-304d) |
| *(closing commit)* | after 22:34 | docs: record K-304d. Pushed to PR #6; its CI result and the merge are recorded at the start of the next branch. |

---

## S-10: K-405 Participant self-service

| Field | Record |
|---|---|
| **Start** | 2026-10-12 00:30:37 +04:00 |
| **End** | 2026-10-12, at the closing documentation commit on `feature/k-405-participant-self-service`. The activity table ends at 00:55. |
| **Cards** | K-304d (Review → Done), K-405 (To Do → In Progress → Review) |
| **Tools and model** | Claude Code 2.1.296, model `claude-opus-5-5`; GitHub CLI 2.101.0; the S-02 toolchain |
| **Significant prompt** | "CONTINUE OUR EXISTING … DEVELOPMENT": do not merge `dev` into `main`; record K-304d Done; implement K-405 per FR-SELF-1 to FR-SELF-4, FR-LNK-1 to FR-LNK-10, FR-ROT-1 to FR-ROT-11 and FR-SHR, with integration, concurrency, rollback and no-raw-token tests and browser tests; a pull request into `dev`; then K-406 in a separate pull request. |

**Activity:**

| Local time | Activity | Result |
|---|---|---|
| 00:30:37 | Verified `dev` = `origin/dev` = `d90062e`, `main` = `8c1247d`; PR #5 and PR #6 merged; final runs 38162851806 and 38164505147 `success`; dev database schema 4 | — |
| 00:30:50 | `feature/k-405-participant-self-service` from `origin/dev` | — |
| 00:30–00:32 | Read FR-SELF, FR-ROT, FR-LNK, FR-SHR, FR-NTF-10 to FR-NTF-14; the §4.9 rows "Ticket resend" and "Management link replaced"; API #9 to #11, API_DESIGN §7.3; TX-P01 to TX-P03; `rotation_requests`; U-20, FK-16 to FK-18; the `access_tokens` guard trigger | FK-17 and FK-18 are `NO ACTION` and not deferrable, so the §8.4 deletion order needs rotation requests first (PD-47) |
| 00:32:39 | Commit | `c1ba465` docs(process): K-304d Done; PD-47 to PD-51 |
| 00:33–00:35 | Migration `0005`, schema type, six error codes, two rate rules, the deletion-order change, `issueTokenWithId`, `participant-portal/portal.ts` and `routes.ts`, the `ticket_resend` and "management link replaced" handlers, the optional log destination | Typecheck and lint pass |
| 00:35:06 | `pnpm migrate` on `ers_dev` ("applied 0005_rotation_requests.sql"); web and worker restarted | `/healthz` schema version 5 |
| 00:36:43 | `portal.test.ts` (16 tests) | **16 failed** within milliseconds, from one shared cause: the harness `resetData` truncates a fixed table list that lacked the new `rotation_requests` table (referencing `access_tokens`). `rotation_requests` and `deletion_markers` were added to it. |
| 00:37:10 | Rerun | **15 passed, 1 failed:** the AC-75 test. The second of two simultaneous rotations got the generic 404, because the first had revoked every management token, including the second's. AC-75 requires both to commit (PD-52). |
| 00:38:04 | Implemented PD-52 (token validity at submission; revoked meanwhile only by a concurrent rotation) | Still 404. Tracing showed the second request's token lookup ran after the first had committed: the in-process requests were not really concurrent, so the test did not exercise AC-75. |
| 00:39:44–00:40:59 | The test now holds the event lock until both requests wait on it (polling `pg_stat_activity`). The first attempt polled as the owner role, which cannot see the runtime role's wait states; fixed by polling as the runtime role. | **16/16 four times** |
| 00:42:08 | Five mutation checks | No AC-75 allowance → 1 test fails; new token revoked too → 7; both types revoked → 3; no FR-ROT-11 check → 2; no resend limit → 1. Source restored. |
| 00:45:26 | Server suite **99/99**; commit | `da1ee09` feat(portal): ticket resend, share links and link rotation (K-405) |
| 00:45–00:47 | UI: "Your ticket" and "Replace your links" cards, `replaceLinkToken`; client unit test; `portal.spec.ts` | Client 6/6; typecheck and lint pass |
| 00:47:34–00:53:16 | Full suite | `format:check`, `lint`, `typecheck`, `test` (server 99/99, client 6/6) and `build` exit 0; **E2E 14/14 three times**. Commit `704c241`. |
| 00:53:31 | Pushed; [PR #7](https://github.com/DavidMalkhasyan/event-registration-system/pull/7), `dev` ← `feature/k-405-participant-self-service` | CI [run 38174098814](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38174098814) **passed** in 2 min 39 s: **5 migrations** on a fresh database; 99/99, 6/6, 14/14 |

**Commits in S-10:**

| Hash | Time (+04:00) | Message |
|---|---|---|
| `e235112` | 2026-10-11 22:35:57 | docs: record K-304d … S-09's closing commit |
| `d90062e` | 2026-10-11 22:39:03 (GitHub) | Merge K-304d: event deletion (#6) |
| `c1ba465` | 00:32:39 | docs(process): K-304d Done; K-405 started with decisions PD-47 to PD-51 |
| `da1ee09` | 00:45:26 | feat(portal): ticket resend, share links and link rotation (K-405) |
| `704c241` | 00:53:16 | feat(client): participant self-service on the management page (K-405) |
| *(closing commit)* | after 00:55 | docs: record K-405. Pushed to PR #7; the CI result and the merge are recorded at the start of the next branch. |
