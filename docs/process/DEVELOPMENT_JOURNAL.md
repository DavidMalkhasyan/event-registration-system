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

---

## S-11: K-405 merged; K-406 Staff invitations and sessions

| Field | Record |
|---|---|
| **Start** | 2026-10-12 00:59:48 +04:00 (continuation of the S-10 prompt: "After K-405 is successfully merged into dev, proceed with … K-406") |
| **End** | 2026-10-12, at the closing documentation commit on `feature/k-406-staff-invitations`. The activity table ends at 01:28. |
| **Cards** | K-405 (Review → Done), K-406 (To Do → In Progress → Review); K-504 partly (minimal staff check-in screen) |
| **Tools and model** | Claude Code 2.1.296, model `claude-opus-5-5`; GitHub CLI 2.101.0; the S-02 toolchain |

**Activity:**

| Local time | Activity | Result |
|---|---|---|
| 00:56–00:59 | K-405 closing documentation `8567170` pushed to PR #7; diff reviewed (22 files, no secrets, only replaced lines removed); final CI run [38174318350](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38174318350) **passed** (5 migrations; 99/99, 6/6, 14/14) | — |
| 00:59:52 | `gh pr merge 7 --merge` | `35d9213` on `dev`; tree equals the tested head; `main` unchanged |
| 01:00–01:01 | `feature/k-406-staff-invitations` from `origin/dev`. Read: FR-STAFF-1 to FR-STAFF-7; API #14 to #16 and #41 to #50 and their schemas; TX-S01 to TX-S03 and TX-C01; `staff_invitations` and `staff_sessions`; U-16 to U-19, FK-10, FK-14, FK-15, CK-35; ADR-010 §3 and §5; AC-26, AC-82, AC-96, AC-101, AC-111, AC-151, AC-156, AC-186, EC-104; the existing staff hooks in `0001` | The outbox has no per-type reference constraint, so the invitation email can use `request_ref` (PD-54) |
| 01:02:21 | Commit | `bf73afd` docs(process): K-405 Done; PD-53 to PD-58 |
| 01:02–01:07 | Migration `0006`, schema types, `staff-sessions.ts`, the 403 for staff-only callers, check-in generalized to owner or staff, count and stream for staff, `staff/staff.ts` and `routes.ts`, the invitation email handler, the cancellation and deletion hooks | One combined shell edit was rejected by the shell for quoting before it ran; nothing was applied; redone with script files |
| 01:07:58 | `pnpm migrate` on `ers_dev` ("applied 0006_staff.sql"); existing server suite | **99/99**: the check-in refactor broke nothing; web and worker restarted |
| 01:11:06 | `staff.test.ts` (11 tests) | **10 passed, 1 failed.** The harness app has no live hub, so the count and stream routes don't exist there. This also showed that an assertion in the authorization test ("count of another event → 404") passed only because the route was missing, a false positive. Both count checks moved to the live-stream group, which runs a real server with the hub. |
| 01:12:42 | Rerun three times | 11/11 each |
| 01:13:34–01:14:54 | Mutation checks | No staff re-check after the lock → AC-156 test fails; accept not single-use → AC-82 fails; cancellation keeps invitations → fails; stream ignores staff revocation → AC-186 fails. "No 403 for staff" at first did not apply (Prettier had reformatted the line, so its "11 passed" proved nothing); rerun against the formatted text → fails. Sources restored. |
| 01:17:22 | Server suite **110/110**; commit | `c6437d6` feat(staff): staff invitations, device sessions and staff check-in |
| 01:17–01:19 | UI: `/invite` page, `/staff` screen (check-in component parameterized for staff), "Staff" card; Vite and static routing | Client 6/6; typecheck and lint pass |
| 01:19:41–01:26:47 | Full suite | `format:check`, `lint`, `typecheck`, `test` (server 110/110, client 6/6) and `build` exit 0; **E2E 15/15 three times**. Commit `465acbf`. |
| 01:27:04 | Pushed; [PR #8](https://github.com/DavidMalkhasyan/event-registration-system/pull/8), `dev` ← `feature/k-406-staff-invitations` | CI [run 38176421220](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38176421220) **passed** in 2 min 47 s: **6 migrations** on a fresh database; 110/110, 6/6, 15/15 |

**Not covered by an automated test:** AC-186 (c), a staff stream with no check-ins being closed within 30 s plus one check, because the test would have to wait over 30 seconds. The 30-second re-check is the existing timer shared with organizer streams.

**Commits in S-11:**

| Hash | Time (+04:00) | Message |
|---|---|---|
| `8567170` | 00:56:46 | docs: record K-405 … S-10's closing commit |
| `35d9213` | 00:59:51 (GitHub) | Merge K-405: participant self-service (#7) |
| `bf73afd` | 01:02:21 | docs(process): K-405 Done; K-406 started with decisions PD-53 to PD-58 |
| `c6437d6` | 01:17:22 | feat(staff): staff invitations, device sessions and staff check-in (K-406) |
| `465acbf` | 01:26:47 | feat(client): staff invitation, staff check-in screen and owner staff card (K-406) |
| *(closing commit)* | after 01:28 | docs: record K-406. Pushed to PR #8; the CI result and the merge are recorded at the start of the next branch. |

---

## S-12: K-406 merged; K-306 Check-in undo

| Field | Record |
|---|---|
| **Start** | 2026-10-12 09:16:19 +04:00 (prompt 16: "CONTINUE THE EXISTING EVENT REGISTRATION SYSTEM ROADMAP … Begin with closing K-406, then implement K-306") |
| **End** | 2026-10-12, at the closing documentation commit on `feature/k-306-checkin-undo`. The activity table ends at 10:24. |
| **Cards** | K-406 (Review → Done), K-306 (Partly done → In Progress → Review) |
| **Tools and model** | Claude Code, model `claude-opus-5-5`; GitHub CLI; the S-02 toolchain |

**Activity:**

| Local time | Activity | Result |
|---|---|---|
| 09:16 | `dev` synchronized: `dev` = `origin/dev` = `f547477`; [PR #8](https://github.com/DavidMalkhasyan/event-registration-system/pull/8) merged 01:33:57 with merge commit `f547477`; its final CI run [38176668486](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38176668486) **passed**; the development database reports schema version 6; `main` = `8c1247d`, unchanged | `feature/k-306-checkin-undo` from `origin/dev` |
| 09:17–09:19 | Read: FR-CHK-8, BR-7, AC-26, AC-27, AC-54; API #44 with `UndoInput` and `CheckInUndone`; TX-C02; DATABASE_DESIGN §8 and the `audit_records` column rules; CK-30, U-13, TR-06 and TR-07 in `0001` | The participant list already returns `checkInId`; TR-07 already notifies on UPDATE. No migration is needed. |
| 09:20:14 | Commit | `710b9bd` docs(process): K-406 Done; decisions PD-59 (where the reason is kept) and PD-60 (eligibility) |
| 09:20–09:22 | `undoCheckIn` in `checkin.ts`, the route, the `check_in_already_undone` problem code; typecheck | Passes |
| 09:22:55 | `checkin-undo.test.ts` (9 tests) | **6 passed, 3 failed**, all because of mistakes in the tests: the participant list is under `items`, not `participants`; a check-in after the window answers `OUTSIDE_CHECK_IN_WINDOW` before `ALREADY_CHECKED_IN`; and the stream reader matched the earlier count already in its buffer. Fixed. The cancelled-event case first got 401 because moving the clock into the window expired the recent sign-in that cancellation needs, so the test now signs in again first. Then **9/9**. |
| before 09:29 | Mutation checks, each run against the undo tests and then restored | No "already undone" check → 2 tests fail; no owner check → 1; shared instead of exclusive lock → 1 (the simultaneous-undo test); no audit record → 4; check-in of any event → 1; no CSRF → 1 |
| 09:29:02 | Server suite **119/119**; commit | `f5d4b34` feat(checkin): owner undo of a check-in with audit record |
| 09:30–10:15 | Owner UI: "Undo check-in" in the participants table with a confirmation step, an optional reason and a result message; E2E `checkin-undo.spec.ts` | The first E2E run **failed**: after the undo, the test reloaded the share page, which correctly showed "Link not valid", because the link token is kept only in memory (the bootstrap removes it from the address). The test now opens the link again in a new tab. That run was slow and also reported "2 errors were not a part of any test"; its output was cut off, so the cause was not seen. None of the following runs repeated it. |
| 10:15:44 | E2E `checkin-undo.spec.ts` alone | 1/1 |
| 10:16:32–10:20:39 | Full suite | `format:check`, `lint`, `typecheck`, `test` (server 119/119, client 6/6), `build` and `e2e` (**16/16**) exit 0 |
| 10:20:50 | Commit | `4a598ac` feat(client): owner undo of a check-in with confirmation |
| 10:20–10:23:49 | E2E twice more | 16/16 both times |

**Commits in S-12 (so far):**

| Hash | Time (+04:00) | Message |
|---|---|---|
| `710b9bd` | 09:20:14 | docs(process): K-406 Done; K-306 undo started with decisions PD-59 and PD-60 |
| `f5d4b34` | 09:29:02 | feat(checkin): owner undo of a check-in with audit record (K-306) |
| `4a598ac` | 10:20:50 | feat(client): owner undo of a check-in with confirmation (K-306) |
| *(closing commit)* | after 10:24 | docs: record K-306. Pushed with the pull request; the CI result and the merge are recorded at the start of the next branch. |

**S-12, continued: K-306 merged; K-305b Waiting-list removal**

| Local time | Activity | Result |
|---|---|---|
| 10:25:37–10:28:41 (UTC 06:25–06:28) | [PR #9](https://github.com/DavidMalkhasyan/event-registration-system/pull/9), `dev` ← `feature/k-306-checkin-undo`; diff reviewed (12 files, no secrets) | CI [run 38212459702](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38212459702) **passed**: 6 migrations on a fresh database; 119/119, 6/6, 16/16 |
| 10:29:00 | `gh pr merge 9 --merge` | `2efd8f1` on `dev`; tree equals the tested head; `main` unchanged |
| 10:29–10:30 | `feature/waitlist-removal` from `origin/dev`. Read: FR-WL-10 to FR-WL-14, FR-NTF-14, BR-23, BR-24, BR-27, AC-76 to AC-79, AC-90 to AC-92, TX-W01, API #43 with `WaitlistRemovalInput`, the `waitlist_removed` policy (required, class B) | No Kanban card existed (PD-61). The design has no column for the optional removal reason, and the audit table may not hold free text (PD-63). |
| 10:30:36 | Commit | `9b59de4` docs(process): K-306 Done; PD-61 to PD-63 |
| 10:31–10:33 | Migration `0007`, `removeFromWaitlist` (TX-W01), the route, the `not_waitlisted` problem code, the `waitlist_removed` handler | Typecheck passes |
| 10:33:53 | `waitlist-removal.test.ts` (10 tests) | **9 passed, 1 failed:** the AC-91 loop got `429` from event cancellation after five runs, because cancellation is limited to 5 per 15 minutes per account (D3). This is correct behaviour; the test now moves the clock on 16 minutes and signs in again every 4 runs, so it obeys the limit and the recent-sign-in rule. Its lock helper now always releases, because the failure had left the held lock open until the hook timed out. Then **10/10**. A test for two simultaneous removals was added: **11/11**. |
| before 10:42 | Mutation checks, each restored | No `WAITLISTED` re-check → 4 tests fail; no event-status check → 2; no owner check → 1; another event's registration → 1; shared lock → 1 (two simultaneous removals); no notice → 7; the notice not treated as required → 3 |
| 10:42–10:45 | Server suite **130/130**; lint; `pnpm migrate` on `ers_dev` ("applied 0007_removal_reason.sql"); web and worker restarted; `/healthz` reports schema version 7 | `a38a313` feat(waitlist): owner removal of a waiting-list entry with a required notice |
| 10:45–10:47 | UI "Remove from waiting list" with confirmation and optional reason; E2E `waitlist-removal.spec.ts` | 1/1 on the first run |
| 10:47:53–10:53:07 | Full suite | `format:check`, `lint`, `typecheck`, `test` (130/130, 6/6), `build` and `e2e` (**17/17**) exit 0 |
| 10:53:17 | Commit | `4e7ccc8` feat(client): owner removes a waiting-list entry with confirmation |
| 10:53–10:58 | E2E twice more | 17/17 both times |

**Note on AC-91:** the test runs 100 times with both requests waiting on the event lock, plus each order forced once. Which request takes the lock first is up to PostgreSQL, so the split between the two outcomes across the 100 runs is not fixed. The two forced runs guarantee that each outcome is checked.

**Commits in S-12 (continued):**

| Hash | Time (+04:00) | Message |
|---|---|---|
| `9e83ed1` | 10:25:12 | docs: record K-306 … (closing commit of PR #9) |
| `2efd8f1` | 10:29:00 (GitHub) | Merge K-306: owner undo of a check-in (#9) |
| `9b59de4` | 10:30:36 | docs(process): K-306 Done; K-305b waiting-list removal started with decisions PD-61 to PD-63 |
| `a38a313` | 10:45:33 | feat(waitlist): owner removal of a waiting-list entry with a required notice (K-305b) |
| `4e7ccc8` | 10:53:17 | feat(client): owner removes a waiting-list entry with confirmation (K-305b) |
| *(closing commit)* | after 10:58 | docs: record K-305b. Pushed with the pull request. |

**S-12, continued: K-305b merged; K-506 UI inventory**

| Local time | Activity | Result |
|---|---|---|
| 11:00:04–11:03:35 (UTC 07:00–07:03) | [PR #10](https://github.com/DavidMalkhasyan/event-registration-system/pull/10), `dev` ← `feature/waitlist-removal`; diff reviewed (14 files, no secrets) | CI [run 38215349977](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38215349977) **passed**: 7 migrations on a fresh database; 130/130, 6/6, 17/17 |
| 11:03:50 | `gh pr merge 10 --merge` | `d219576` on `dev`; tree equals the tested head; `main` unchanged |
| 11:04–11:06 | `feature/ui-inventory` from `origin/dev`. Read the client files, both HTML entries, the Vite and server entry routing, the API calls of every screen, the styles, and every locator in the 11 E2E specs and their helpers | `docs/frontend/UI_INVENTORY.md` (K-506, PD-64). Three first-draft statements were corrected against the code before commit: the navigation helper's size, the locator count (about 200 lines, not 220), and the offline check-in wording. No application code changed; the redesign was not started. |

---

## S-13: UI redesign to the approved v0 design (K-507)

| Field | Record |
|---|---|
| **Start** | 2026-10-12 11:34 +04:00 (prompt 17: implement the approved v0 design in the existing application) |
| **Cards** | K-506 (Review → Done), K-507 (In Progress), K-504 remainder |
| **Tools and model** | Claude Code, model `claude-opus-5-5`; GitHub CLI; the S-02 toolchain; Playwright with Edge for screenshots |

**Activity:**

| Local time | Activity | Result |
|---|---|---|
| 11:34 | `git clone https://git.v0.app/…/eventflow-v0-design.git` | **Blocked:** `401 Unauthorized`, `Www-Authenticate: Bearer realm="v0 managed git"`. The clone waited in Git Credential Manager; it was stopped and its empty directory (no objects) removed. Reported to the stakeholder; no credentials requested. |
| 11:52 | The stakeholder published the design on GitHub; cloned to the sibling directory `../eventflow-v0-design` (`6a62aac`) | Read every source file: `src/App.tsx`, `components/*.tsx`, `demo-store.ts`, `app/globals.css` (3,029 lines), the shadcn primitives, `package.json`, Vite config, assets |
| 11:54–11:58 | `pnpm install` in the design repository; preview on port 5190; screenshots of nine screens at 1440 and 390 px with Playwright (Edge) | The preview runs. Findings: a prototype on an in-memory demo store with hash routing; `next` and `@vercel/analytics` are declared but unused by the Vite entry; several classes the components use have **no CSS** (poster fallbacks for events without photos, the event cover caption, the overview's bottom sections), so those parts render unstyled in v0 itself |
| 12:00–12:02 | Read `UI_INVENTORY.md`, both client entries in full, the E2E helpers and specs; confirmed 15 handlers in `HANDLERS`; reviewed PD-63 and migration `0007` (written only by TX-W01, constrained to `removed_by_organizer`, deleted with the registration) | No schema change needed. `feature/ui-redesign` from `origin/dev` (`dd23b93`). Decisions PD-65 to PD-70. |
| 12:04:09 | `GET /api/events` with per-event `waitlistedCount` and `checkedInCount`; an integration test with two events of one organizer, another organizer's event and an undone check-in | Pass; a mutation check (no `undone_at` filter) makes it fail. Commit `7156c81`. |
| 12:05–12:20 | `lucide-react` 1.17.0 added (ISC); the three v0 photographs compressed from 4.7 MB to 359 KB; `shared/styles.css` rewritten from v0's CSS; `shared/ui.tsx` primitives | Typecheck passes |
| 12:20 | The Claude Code process ended while background tasks were running; work in the tree was intact. On resuming, two copies of the dev web server and worker were found (processes from before the restart had survived their stop request); all four were stopped and one of each restarted. | No data affected; `/healthz` schema 7 |
| 12:20–12:50 | Organizer modules (router, shell, auth, overview, All events, creation, workspace sections), `checkin/` and `staff.html` | Lint found `setState` in effects and a ref read during render; fixed by moving the state change into the click handler, tagging result messages with their section, and destructuring the navigation hook |
| 12:52–12:55 | Browser review on the real stack: an organizer signed in through the UI and the emailed link; four events, eleven registrations, a waiting list, two check-ins and a cancellation created through the API; screenshots of ten organizer screens at 1440, 768 and 390 px (Playwright, Edge) | No horizontal overflow at any width. Found and fixed: poster text under the date pill; a wrapping "All events" link on phones; a `favicon.ico` 404 (now an inline SVG). The check-in panel heading became `h2` inside the workspace. |
| 12:56–13:00 | E2E suite after updating its helpers | **0/17**: the copy button's label ("Copy Public registration link") also matched `getByLabel`, and then the scanner region's label contained "ticket code". Both were ambiguous names in the new markup and were fixed there; `/capacity 2/` became the "Event capacity" tile. Then 17/17. |
| 13:00–13:02 | New E2E `organizer-workspace.spec.ts` | **Failed** on a real defect: the overview showed stale totals after participants registered elsewhere, because the event list was loaded once. Fixed by reloading it on every navigation; 2/2. |
| 13:03:50–13:08:19 | Full suite | `format:check`, `lint`, `typecheck`, `test` (server 131/131, client 11/11), `build` and `e2e` (**19/19**) exit 0 |
| 13:08–13:10 | Bundle inspection | `staff.html` loads 1.7 KB of its own code plus the shared UI and check-in chunks; no organizer endpoint in the staff or public bundles. The shared library chunk evaluates before the token bootstrap on link pages; a build of `dd23b93` shows the same order, so this predates the redesign (PD-71). |
| 13:10 | Commits | `1689c9b` design system; `459b897` organizer area, check-in and staff entry; `bb2606b` tests |
| 13:10–13:18 | [PR #12](https://github.com/DavidMalkhasyan/event-registration-system/pull/12), `dev` ← `feature/ui-redesign`; diff reviewed (56 files; the only secret-scan hit was the journal's quotation of the `Bearer realm` header) | CI [run 38228535365](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38228535365) **passed**: 7 migrations; 131/131, 11/11, 19/19 |
| 13:18:42 | `gh pr merge 12 --merge` | `1172ec0` on `dev`; tree equals the tested head; `main` unchanged |
| 13:14–14:30 | Part 2 on `feature/ui-redesign-participant` (fast-forwarded to `1172ec0`): `public/main.tsx` split into `EventPage`, `LinkPages`, `ManagePage` and a shell with the v0 ticket card; artwork moved to `shared/` and keyed on the public ID; legacy `Page`/`Card` removed | Typecheck and lint clean; E2E 19/19 on the first run |
| 14:20–14:30 | Browser review with real links from the dev mailbox: event page (open, cancelled), verification, management (confirmed, waiting), share view, sign-in, staff invitation, invalid link, staff without access, at 1440, 768 and 390 px; a real staff session on a phone viewport (invite, accept, check-in, duplicate) | No overflow; the token left the address bar on every page; browser storage `{}`; no request to another origin; the staff device's call to the organizer participant list got `403`. Fixed: the tagline style also hit the header logo; a cancelled event read "You’re invited." and listed the registration deadline; a compact scanner and wrapping result on phones. |
| 14:25 | New E2E `link-pages.spec.ts` | 1/1; a mutation check (a hosted font in `public.html`) makes it fail; restored |
| 14:32:53–14:37:42 | Full suite | `format:check`, `lint`, `typecheck`, `test` (131/131, 11/11), `build` and `e2e` (**20/20**) exit 0. A two-line copy change for cancelled events followed (typecheck and lint rerun); the part 2 CI run covers it. |
| 14:40 | Commits | `67764a9` participant and link pages; `fbe2a33` link-page test |
| 14:46:02 | [PR #13](https://github.com/DavidMalkhasyan/event-registration-system/pull/13) merged after CI [run 38237911736](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38237911736) passed (131/131, 11/11, 20/20) | `82b1c1c` on `dev`; `main` unchanged |

---

## S-14: Release hardening (PD-71 approved), FR-LNK-8 headers, camera tests, K-105

| Field | Record |
|---|---|
| **Start** | 2026-10-12 14:54:24 +04:00, branch created (prompt 19: "FINAL SECURITY HARDENING AND RELEASE READINESS") |
| **Cards** | K-507 (Review → Done), K-605 (new, Review), K-105, K-603 |
| **Tools and model** | Claude Code, model `claude-opus-5-5`; GitHub CLI; the S-02 toolchain; Playwright with Edge |

**Activity:**

| Local time | Activity | Result |
|---|---|---|
| 14:54 | `feature/security-hardening` from `dev` (`82b1c1c`). Read FR-LNK-8, FR-LNK-10, AC-51, ADR-011 and the header code | No CSP header anywhere; `no-store` only on `/api` and `/dev`; `noindex` only as a meta tag |
| 14:55–14:57 | Prototype: `boot.ts` (only static import: the bootstrap) plus a dynamic `import()` of the app; production build inspected | The entry chunk still began with `import "./modulepreload-polyfill-….js"`; with `modulePreload.polyfill: false` the entry has **no static imports** and starts with the capture; the app chunk imports `linkToken` from the evaluated entry (one instance) |
| 14:57–14:59 | `token-bootstrap.spec.ts`: a probe prepended to every non-entry chunk and a `fetch` wrapper, on the production build, for verification, management, ticket, sign-in, invitation and invalid links | 1/1. **Mutations:** the pre-fix entry fails ("/assets/ui-….js executed before the token was captured", hash `#t=…`); a re-enabled polyfill fails the same way. Restoring the second mutation with `git checkout` also discarded an uncommitted comment change, which was re-applied. Commit `e5dfbdc`. |
| 15:00–15:02 | FR-LNK-8 headers in the shared `onSend` hook; `security-headers.test.ts` (temporary dist); E2E checks of the headers and of CSP violations | 4/4; E2E 4/4 with no violations; an inline script in `public.html` is reported and fails the test. Commit `8f0586a`. |
| 15:02–15:04 | Camera scanning review and `camera-scan.spec.ts` (controlled `getUserMedia` and `BarcodeDetector`, real staff session and endpoint) | Defect fixed: a code held in view was re-submitted about every 2.3 s. 1/1; mutations (the old loop, no track cleanup) fail. **No physical device was tested.** Commit `9a52edd`. |
| 15:04–15:06 | K-105: `scripts/check-secrets.mjs`, `pnpm audit --audit-level=high`, a migration idempotency step in CI | Clean (177 files; no known vulnerabilities); a planted token is caught. Commit `47977c4`. README walkthrough and table updated: `c2c38e7`. |
| 15:06:24–15:11:30 | Full suite | **lint failed** (Node globals for `scripts/*.mjs`) and **E2E 21/22**: the last spec got "Too many requests" because 22 tests exceeded the real per-IP registration limit. The limit was kept; a fixture clears the counters in the test database before each test (PD-73). Then 22/22. Commit `7d8439b`. |
| 15:17–15:45 | Clean setup from the README: a fresh clone and a new PostgreSQL 18 cluster on port 54399 (the development database untouched) | First run: the script stopped at a `grep -c` returning 1 for zero placeholders, and its output was held by the throwaway server inheriting the pipe; second run: pnpm could not write its task state in the long scratch path (a Windows path-length limit of the test location). Third run in a short directory: install, provisioning, 7 migrations, "schema is up to date", secret scan, format, lint, typecheck, **135/135 and 11/11**, build, the production-like run with the FR-LNK-8 headers, and **E2E 22/22**. The work directory and cluster were removed. |
| 15:40 | Development mode: a real verification link through the Vite dev server | Works; the fragment is removed; no errors |
| 15:46:41 | Records commit `25e9ffc`: K-507 Done, PD-71 resolved, PD-72 to PD-75, K-605, milestones, scope and this entry | — |
| 15:47:06 | [PR #14](https://github.com/DavidMalkhasyan/event-registration-system/pull/14), `dev` ← `feature/security-hardening` | CI [run 38244890522](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38244890522), 15:47:09–15:51:28, **passed**: secret scan (179 files), dependency audit (no known vulnerabilities), format, lint, typecheck, 7 migrations and an idempotent repeat, 135/135, 11/11, build, 22/22 |
| 15:51:48 | `gh pr merge 14 --merge` | `cf35cbd` on `dev`; its tree equals the tested head `25e9ffc`; `main` unchanged |

The last three rows were added in S-15 from GitHub's records of the pull request and the CI run; S-14's own entry was committed before them.

---

## S-15: Final documentation audit and release preparation (K-603)

| Field | Record |
|---|---|
| **Start** | 2026-10-12 16:49:26 +04:00 (prompt 20: "FINAL DOCUMENTATION AUDIT AND RELEASE PREPARATION") |
| **Stakeholder decisions** | K-001 approved for the R60 synchronization only; K-605 approved as complete; K-004 not yet approved (a final accuracy pass first); K-603 to be completed before the release; no merge into `main`, no tag, no submission (PD-76) |
| **Cards** | K-001 and K-605 (Review → Done); K-105, K-304, K-404 and K-504 closed as Done (their remaining parts were finished in earlier sessions); K-603 (In Progress → Review); K-004 stays in Review; K-604 stays in To Do |
| **Tools and model** | Claude Code 2.1.296, model `claude-opus-5-5`; GitHub CLI; the S-02 toolchain; Playwright with Edge |

**Activity:**

| Local time | Activity | Result |
|---|---|---|
| 16:49:46 | `feature/final-docs-audit` from `dev` (`cf35cbd`). Read SUBMISSION_CHECKLIST, ASSIGNMENT_SCOPE, README, MILESTONES, KANBAN, AI_USAGE and the decision log against the code | Stale: test counts (23/3/4), 2 migrations, "camera unverified", unmerged-branch rows, M6 "Done", the checklist's S-03 state; a corrupted §1 table header in ASSIGNMENT_SCOPE |
| 16:50:18–16:50:44 | Counted from the code: API route registrations, tables per migration, tests per file, E2E specs | 39 API routes plus `/healthz` and `/dev/mailbox`; 7 migrations, 20 tables; 135 server tests in 15 files, 11 client tests, 22 browser tests in 14 specs |
| 16:50:57–16:51:27 | Image provenance: the v0 PNGs carry XMP (IPTC `trainedAlgorithmicMedia`, credit "Made with Google AI"); the bundled JPEGs had lost it in the S-13 compression. The design repository has no licence, README or credits file | Re-encoded with the metadata kept (93, 199 and 69 KiB); licence reported as **not established** (PD-77). Commit `37d5812` (16:52:22) |
| 16:51:37–16:52:22 | KANBAN: K-001 and K-605 Done with the approval's exact scope; completed parent cards closed | Commit `18cd457` |
| 16:52:30–16:53:07 | SUBMISSION_CHECKLIST rewritten; `git grep` for local paths; pull-request count and the `.env.example` commit checked | No local user-profile path in tracked files; 14 merged pull requests |
| 16:53:55–16:54:45 | ASSIGNMENT_SCOPE: current release state, CI run 38244890522, per-file test counts, new paths, camera as simulated-API tested, a verification-levels table and known limitations; S-03 history kept | Commit `c34ca36` |
| 16:54:50–16:59:36 | README (clean clone repeated in S-14, camera tests, platform, limitations, future improvements, v0 attribution) and MILESTONES (K-001 approved; M6 **In progress**) | Commit `32847ac`. One edit command waited 2 minutes on a stray `cat` reading standard input (16:56:51–16:58:57); it was stopped, the README was confirmed unchanged and the edit was rerun from a script file |
| 16:59:40–17:01:02 | AI_USAGE (v0 design and images, `lucide-react`, ChatGPT as the stakeholder stated it, prompt 20) and SUBMISSION_CHECKLIST (current state; release PR, tag and submission open) | Commit `7d8f152`. ChatGPT: no repository file, commit or transcript content shows its output; recorded as the stakeholder's statement (PD-78) |
| 17:01:09–17:02:33 | Cross-document audit: decision ranges, session ranges, pull-request count (14 merged, all into `dev`), PR #14's times from GitHub (added to S-14), K-202 and K-501 growth notes, PD-Q4 resolved by PD-75, PD-76 to PD-78 and two open decisions (PD-Q7 image rights, PD-Q8 release) | `REQUIREMENTS.md` unchanged (`git diff cf35cbd` empty) |
| 17:02:53–17:08:35 | Full gates on the working tree (all S-15 changes) | `check:secrets` ("No secrets found in 179 tracked files"), `check:deps` ("No known vulnerabilities found"), `format:check`, `lint`, `typecheck`, `test` (server **135/135**, client **11/11**), `build` and `e2e` (**22/22**, Edge) exit 0. No application code changed in S-15; the images changed only in metadata and encoding |
| 17:09:25 | Pushed; [PR #15](https://github.com/DavidMalkhasyan/event-registration-system/pull/15), `dev` ← `feature/final-docs-audit` | CI [run 38253717986](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38253717986), 17:09:27–17:14:31, **passed**: secret scan (179 files), dependency audit (no known vulnerabilities), format, lint, typecheck, 7 migrations and an idempotent repeat, 135/135, 11/11, build, 22/22 |
| 17:15:12 | `gh pr merge 15 --merge` after a review of the diff (11 files; documentation and image metadata only) | `bb6db50` on `dev`; its tree equals the tested head `093ccfe`; `main` unchanged (`8c1247d`) |

The last two rows were added in S-16 from GitHub's records; S-15's own entry was committed before them.

---

## S-16: Release preparation: K-004 and K-603 closed, photographs replaced by CSS posters, release pull request

| Field | Record |
|---|---|
| **Start** | 2026-10-12 17:20:12 +04:00 (prompt 21: "FINAL RELEASE PREPARATION — APPROVED DECISIONS") |
| **Stakeholder decisions** | K-004 approved; K-603 approved subject to recording PR #15; remove the three AI-generated photographs and replace them with original CSS posters; the physical camera check stays a documented limitation; open the release pull request `dev` → `main` but do not merge it, tag or submit (PD-79) |
| **Cards** | K-004 and K-603 (Review → Done); K-604 stays in To Do |
| **Tools and model** | Claude Code 2.1.296, model `claude-opus-5-5`; GitHub CLI; the S-02 toolchain; Playwright with Edge |

**Activity:**

| Local time | Activity | Result |
|---|---|---|
| 17:20:19 | `feature/release-prep` from `dev` (`bb6db50`); PR #15 and CI run 38253717986 checked on GitHub | Merged 13:15:12 UTC (17:15:12 +04:00) as `bb6db50`; run `success` on head `093ccfe` (event `pull_request`) |
| 17:21:30 | Records: K-004 and K-603 Done, PR #15 rows in S-15, PD-79, PD-Q7 resolved, PD-Q8 partly resolved | Commit `654f500` |
| 17:20–17:23 | Artwork: read `shared/artwork.tsx`, its four call sites and the poster CSS; no test referenced the images | Six CSS poster variants (orbit, sunrise, bauhaus, night, arches, ribbon) replace the three photographs and the three earlier posters; the hash and the six sidebar swatches keep their slots; `git rm` of `apps/client/src/assets/art/*.jpg`; typecheck, lint and client build pass; **0 image files** in `apps/client/dist` |
| 17:24:52–17:25:50 | Review data on the development stack (web, worker, Vite): a review organizer, events, registrations, two check-ins and a cancellation through the real API (nothing deleted); events created until every variant was in use; each variant captured on the card, the workspace cover and the public page at 1440, 768 and 390 px | All six variants covered; no console errors, failed requests or external requests; no `img` elements |
| 17:25–17:28 | Visual review of the captures | Fixed in CSS: the Bauhaus tiles ran under the card's open button and touched the type; the Ribbon bands crossed the type and the year; the cover type collided with the date caption on phones; on the public hero the dark Night poster turned grey under the light overlay and put the dark title on charcoal at 390 px, so the hero now uses a light Night variant. Re-captured: clear at all widths |
| 17:28:54–17:30:47 | Regression review at 1440, 768 and 390 px: overview (global statistics), All events, creation, event workspace with every section, a cancelled event; public event page, verification, management (confirmed and waiting), ticket, sign-in, staff invitation, invalid link, staff without access; a real staff session | **No horizontal overflow** anywhere; no console errors on organizer and staff pages; the only failed responses are the intended `404` (invalid link) and `401` (staff without a session); link fragments removed and nothing stored; no external requests on link pages; a staff device gets `403` from an organizer endpoint |
| 17:30:58–17:36:20 | Full gates | `check:secrets` ("No secrets found in 176 tracked files": the three images left the index), `check:deps` ("No known vulnerabilities found"), `format:check`, `lint`, `typecheck`, `migrate` on the development database ("schema is up to date", schema 7, data kept), `test` (server **135/135**, client **11/11**), `build`, `migrate` again ("schema is up to date") and `e2e` (**22/22**, Edge) exit 0 |
| 17:31–17:33 | Documentation: README, ASSIGNMENT_SCOPE, SUBMISSION_CHECKLIST, MILESTONES, KANBAN (K-604), AI_USAGE (prompt 21, artwork attribution), DECISION_LOG (PD-70 annotated) | The photographs are described as removed, with their history kept; the camera check as an accepted limitation; the release pull request as authorized to open, not to merge |
| 17:37:39 | Commits `68a56b7` (CSS posters, images removed) and `5c820a3` (documentation); pushed; [PR #16](https://github.com/DavidMalkhasyan/event-registration-system/pull/16) opened 17:37:57, `dev` ← `feature/release-prep` | CI [run 38257048688](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38257048688), 17:38:00–17:42:17, **passed** (every step; secret scan of 176 files, dependency audit, 7 migrations and an idempotent repeat, 135/135, 11/11, build, 22/22) |
| 17:42:48–17:42:59 | Diff reviewed (13 files: the artwork module and styles, three removed images, documentation; no server, API or test file; no `url(`, `data:`, `@import` or `<img` in the client change); `gh pr merge 16 --merge` | `35ed4bf` on `dev`, merged 17:42:59; its tree equals the tested head `5c820a3` |
| 17:43:09–17:43:14 | Release review of `main` (`8c1247d`) → `dev` (`35ed4bf`) | `main` is an ancestor of `dev`; 81 commits (16 merges), 119 files; migrations `0003`–`0007` added and `0001`, `0002` unchanged; no image file in `dev`; `REQUIREMENTS.md` unchanged; `.env.example` adds only the `PREVIEW_SECRET` placeholder |
| 17:43:32 | [PR #17](https://github.com/DavidMalkhasyan/event-registration-system/pull/17) opened, `main` ← `dev`, "Release: Event Registration System v1.0.0", not merged | CI [run 38257707045](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38257707045), 17:43:36–17:47:39, **passed** on head `35ed4bf` (same checks; 135/135, 11/11, 22/22); GitHub: mergeable, clean |
| 18:38:15 | Prompt 22: the stakeholder authorized the release merge after five checks; no documentation pull request before it (PD-80) | — |
| 18:38:22 | The five checks | Base `main`, head `dev` at `35ed4bf` with the same 81 commits; run 38257707045 `success` on `35ed4bf`; `MERGEABLE`, `CLEAN`; working tree clean |
| 18:38:34–18:38:40 | `gh pr merge 17 --merge` | Merged at 18:38:40 as `cf804e2` (`cf804e245b616e73a3c98045cf19c154dbc32864`), parents `8c1247d` and `35ed4bf` |
| 18:38:50–18:42:23 | Verified `main` after a fetch | Its tree equals `dev` (`35ed4bf`); migrations `0001`–`0007`; no photographs and no image files; `REQUIREMENTS.md` unchanged. CI [run 38264425015](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38264425015) (push, 18:38:45–18:42:23) **passed**: secret scan (176 files), dependency audit, 7 migrations and an idempotent repeat, 135/135, 11/11, build, 22/22 |
| 18:51:24 | Prompt 23: documentation-only synchronization after the release | `feature/post-release-docs` from `dev` (`35ed4bf`) at 18:51:36; release statements updated in README, ASSIGNMENT_SCOPE, SUBMISSION_CHECKLIST, MILESTONES, KANBAN (K-604 release merge done; tag and submission remain), DECISION_LOG (PD-80, PD-Q8), AI_USAGE (prompts 22 and 23) |

By the stakeholder's decision (PD-80), this synchronization's own pull requests (into `dev`, then into `main`), their CI runs and merges are not recorded here; they are documented in the pull requests themselves. The `v1.0.0` tag and the submission are not done.

---

## S-17: Running the project; live public event availability (K-701)

| Field | Record |
|---|---|
| **Start** | 2026-10-12 19:18:40 +04:00 (prompt 24: "run project"); prompt 25 at 20:33:13 ("ADDITIONAL REQUIREMENT — LIVE PUBLIC EVENT AVAILABILITY") |
| **Cards** | K-701 (new, post-release plan) → Review |
| **Tools and model** | Claude Code 2.1.296, model `claude-opus-5-5`; the S-02 toolchain; Playwright with Edge |

**Activity:**

| Local time | Activity | Result |
|---|---|---|
| 19:18:46–19:19:23 | Prompt 24: checked the development stack and the local branches | Web (:3000, schema 7), worker and Vite (:5173) were already running. `git checkout main` put the working tree on the **stale local `main` (`8c1247d`)** for 10 s, and the watching processes restarted on that code; fast-forwarded to `origin/main` (`8e7f6c1`) at 19:19:06, both restarted cleanly. No migration ran; the database was not touched. Smoke test: `/organizer`, `/staff`, `/e/…`, `/dev/mailbox` 200, `/api/auth/session` 401 (not signed in) |
| 20:33:26 | `feature/public-availability` from `dev` (`37cc9f5`) | — |
| 20:33–20:35 | Read `GET /api/public/events/:publicId`, TX-R01 and TX-R02, the phase and cutoff rules, `promoteFifo`, the capacity rule, the SSE module and its `NOTIFY` triggers, the indexes, FR-REG-2, FR-REG-8 and NFR-SEC-2 | The seat is decided at confirmation (confirmed < capacity); pending verifications hold none; `confirmed_count ≤ capacity` is a database constraint; `registrations_ix07 (event_id, state)` serves the waiting count; the SSE stream is session-authorized and check-in-only. Decision: polling (PD-81) |
| 20:35–20:37 | Server: `availability` in `getPublicEvent`; `public-availability.test.ts` (8 tests) | First run 7/8: the test registered visitors in parallel through a helper that drains the outbox; made sequential (confirmations stay concurrent): 8/8 |
| 20:37–20:40 | Client: `use-public-event.ts` (polling hook), `Availability.tsx`, the registration card; styles | Typecheck and lint pass. Existing browser tests used the old "Register" label: a shared `REGISTER_BUTTON` locator matches both new labels |
| 20:41–20:48 | `public-availability.spec.ts`: one open visitor page; other participants and the organizer act; Playwright's clock advances the 15 s timer | Fixed in the test: duplicate text matches (the visible badge and the screen-reader announcement), an exact text match inside a nested element, and the focus refresh needed the fake clock past the 2 s guard. `cancellation.spec` expected no email field on a cancelled event; the requirement now disables the form, so it checks a disabled field and button (the server's 409 is still checked). Then 1/1 |
| 20:48–20:50 | Mutation checks | `free >= 0` for the mode: 3 server tests fail; counts published in every phase: 2 fail; polling from hidden tabs: the hook test fails. All restored. `use-public-event.test.ts` (3 tests): a missing `cleanup()` let earlier hooks react to later events; fixed in the test |
| 20:50:30–20:51:01 | Visual review on the development stack (real API data): seats, waiting list, closed (rescheduled into the last 2 hours) and cancelled at 1440, 768 and 390 px | Badges and buttons correct in every state; no horizontal overflow; no console errors; no external requests |
| 20:51:23–20:56:56 | Full gates | `check:secrets`, `check:deps` ("No known vulnerabilities found"), `format:check`, `lint`, `typecheck`, `migrate` ("schema is up to date"; development data kept), `test` (server **143/143** in 16 files, client **14/14**), `build` and `e2e` (**23/23**, Edge) exit 0 |
| 20:57:26–20:57:49 | Commits `8285b2e` (server), `8de5934` (client), `2dbc6a4` (browser tests), `216bba8` (records); pushed; [PR #20](https://github.com/DavidMalkhasyan/event-registration-system/pull/20) opened, `dev` ← `feature/public-availability` | CI [run 38281030527](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38281030527), 20:57:52–21:02:50, **passed** (secret scan of 181 files, dependency audit, 7 migrations and an idempotent repeat, 143/143, 14/14, build, 23/23) |
| 21:03:05–21:03:14 | Diff reviewed (19 files; no migration, requirement, configuration or dependency change; no storage, external URL or `innerHTML` in the client change); `gh pr merge 20 --merge` | `a52c3e5` on `dev`; its tree equals the tested head `216bba8`; `main` unchanged |

The last two rows were added in S-18 from GitHub's records.

---

## S-18: Restarting the stack; organizer settings (K-702)

| Field | Record |
|---|---|
| **Start** | 2026-10-12 21:06:26 +04:00 (prompt 26: "interapt and run again"); prompt 27 at 21:24:01 ("EVENTFLOW — ORGANIZER UX FIXES AND REGISTRATION CANCELLATION") |
| **Cards** | K-701 → Done (PR #20); K-702 (new) → Review; K-703, K-704 (new) To Do; K-705 (new) Backlog |
| **Tools and model** | Claude Code 2.1.296, model `claude-opus-5-5`; the S-02 toolchain; Playwright with Edge |

**Activity:**

| Local time | Activity | Result |
|---|---|---|
| 21:06:31–21:07:14 | Prompt 26: stopped the web and worker tasks; their child processes (and Vite) were still listening, so the project's five node processes were stopped by ID; web, worker and Vite started again | `/healthz` schema 7, database ok; `/organizer` and `/staff` 200; worker started |
| 21:24:10–21:25:49 | Prompt 27: read `SettingsTab`, `Reauth`, the workspace data hook, participants and staff tabs, TX-E04, TX-E05, TX-R03, TX-W01, `promoteFifo`, the registration and outbox CHECK constraints, the email handlers, the check-in validity rule and the race-test pattern | The reschedule form started empty; an unchanged start already sends nothing; the out-of-scope list in REQUIREMENTS.md excludes organizer cancellation of a confirmed participant (to be recorded as a proposed amendment with K-703); `end_reason` and `message_type` are CHECK-constrained (K-703 needs migration `0008`) |
| 21:25:54 | `feature/settings-ux` from `dev` (`a52c3e5`) | — |
| 21:26–21:27 | `schedule.ts` (UTC → event-zone datetime-local, offsets) and 5 unit tests | First run 4/5: `Intl` puts a comma after the weekday; built from parts instead: 5/5 |
| 21:29–21:31 | `SettingsTab` rewritten (drafts, confirmed reschedule with the offset choice, one Cancel event, More actions with deletion), `RecentSignIn` removed, styles; workspace texts say emails are queued | Typecheck and lint pass |
| 21:31–21:33 | Browser tests: a shared `reschedule()` helper for four specs; Cancel event label; More actions before deletion; `reauth.spec` now starts the re-authentication from the protected action; new `settings.spec.ts` (Asia/Tokyo event, browser in Europe/Berlin) | settings, reauth, cancellation and deletion specs: 8/8 on the first run |
| 21:33–21:34 | `reschedule.test.ts` (4): unchanged start, real change to confirmed and waiting only, stale version, DST gap and repeat in Europe/Berlin | 4/4 |
| 21:34:31–21:40:18 | Full gates | `check:secrets`, `check:deps`, `format:check`, `lint`, `typecheck`, `migrate` ("schema is up to date"), `test` (server **147/147** in 17 files, client **19/19**), `build` and `e2e` (**25/25**, Edge) exit 0 |
| 21:40:32–21:41:02 | Commits `6c474b7` (client), `1da3a04` (server tests), `1db7fa3` (browser tests), `71c14cc` (records); pushed; [PR #21](https://github.com/DavidMalkhasyan/event-registration-system/pull/21) opened | CI [run 38285842187](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38285842187), 21:41:06–21:45:37, **passed** (secret scan of 185 files, dependency audit, 7 migrations and an idempotent repeat, 147/147, 19/19, build, 25/25) |
| 21:46:00–21:46:04 | Diff reviewed (client, tests and records only; no server source, migration or configuration); `gh pr merge 21 --merge` | `022dff0` on `dev`; its tree equals the tested head `71c14cc`; `main` unchanged |
| 21:46:16 | `feature/organizer-cancellation` from `dev` (`022dff0`) | — |
| 21:46–21:49 | Migration `0008` (end reason `cancelled_by_organizer`, message type `organizer_cancellation` as a required notice); `cancelRegistrationByOrganizer` under the exclusive event lock with `promoteFifo`; route; error code `registration_not_confirmed`; the notice's template (no link, no code); `endReason` in the participant list | Typecheck and lint pass. A first shell edit was rejected by Bash before running (quoting) and changed nothing; redone from a script file |
| 21:50–21:51 | `organizer-cancellation.test.ts` (9): one notice and audit without personal data; ticket, management and share links invalid; FIFO before the cutoff only; refusals; doubled requests; other organizer, missing CSRF, no session, staff; races with participant cancellation, event cancellation and check-in (both forced orders and lock races) | First run 8/9: the test expected 400 for a missing confirmation; the API answers 422 (`validation_failed`), so the test was corrected: 9/9. **Mutations:** without the checked-in guard 2 tests fail; without the promotion 2 fail; restored |
| 21:52–21:53 | Client: Cancel registration (confirmed, not checked in, before the start) with a dialog naming the effect on the waiting list; a checked-in row explains why it can't be cancelled; cancelled rows show their end reason | Typecheck and lint pass |
| 21:53:35 | `organizer-cancellation.spec.ts`: notice, FIFO promotion, in-place update without a page load, invalid links, the open public page at its next refresh, and a checked-in participant | 1/1 on the first run |
| 21:55 | Proposed amendment A-1 ([REQUIREMENT_AMENDMENTS.md](REQUIREMENT_AMENDMENTS.md)) for the conflict with REQUIREMENTS.md §1.2; REQUIREMENTS.md unchanged | — |
| 21:54:37–22:00:48 | Full gates | `check:secrets`, `check:deps`, `format:check`, `lint`, `typecheck`; `migrate` on the **development database: "1 migration(s) applied"** (schema 7 → 8, data kept), again "schema is up to date"; `test` (server **156/156** in 18 files, client **19/19**), `build` and `e2e` (**26/26**, Edge) exit 0. The released `main` (schema 7) refuses to run against this development database until it is pointed at a schema-7 database |
| 22:01:57–22:02:19 | Commits `99fe755` (server), `bb5b0f2` (client), `94a8fe9` (browser test), `563d275` (records); pushed; [PR #22](https://github.com/DavidMalkhasyan/event-registration-system/pull/22) opened | CI [run 38288228868](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38288228868), 22:02:22–22:06:55, **passed** (secret scan of 189 files, dependency audit, **8 migrations** and an idempotent repeat, 156/156, 19/19, build, 26/26) |
| 22:07:26–22:07:29 | Diff reviewed (the migration only widens two constraints; REQUIREMENTS.md, configuration and dependencies unchanged); `gh pr merge 22 --merge` | `16a6fbc` on `dev`; its tree equals the tested head `563d275`; `main` unchanged |
| 22:07:38 | `feature/organizer-refresh` from `dev` (`16a6fbc`) | — |
| 22:07–22:09 | `useAutoRefresh` (single flight with one follow-up, polling while visible, focus throttle, abort on unmount) and 5 unit tests; an optional `AbortSignal` in the API client | 5/5. Lint refused the callback calling itself (`react-hooks/immutability`); the recursion moved into an inner function: lint clean, 5/5 |
| 22:09–22:11 | `RefreshControl`; the event list (overview, All events), the event workspace (event, counts, participants when shown) and the staff section use the scheduler; polls silent, only failures announced | Typecheck and lint pass; client 24/24 |
| 22:12–22:14 | `organizer-refresh.spec.ts` (3): participants and waiting list with search and filter kept, the Refresh button, an unsaved title through two polls, staff acceptance and revocation, the events list in list view with its search, the overview's Refresh; no page load in any | First run 2/3: the overview assertion guessed a wrong locator; the existing `overviewTotal` pattern used, with the value checked before and after Refresh: 3/3. **Mutation:** workspace polling off makes the first test fail; restored |
| 22:15:12–22:16:31 | Visual check on the development stack | The web and worker had stopped at 21:47–21:51 with "schema version 7 does not match the expected version 8" (the safety check, before the development database was migrated at 21:54:57); restarted (schema 8, database ok). Screens at 1440 and 390 px: the Refresh control in the section toolbar, no horizontal overflow |
| 22:16:44–22:23:40 | Full gates | `check:secrets`, `check:deps`, `format:check`, `lint`, `typecheck`, `migrate` ("schema is up to date", schema 8), `test` (server **156/156**, client **24/24** in 6 files), `build` and `e2e` (**29/29**, Edge) exit 0 |
| 22:23:53–22:24:20 | Commits `a325ff2` (client), `1bf628c` (browser test), `668fe04` (records); pushed; [PR #23](https://github.com/DavidMalkhasyan/event-registration-system/pull/23) opened | CI [run 38290681280](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38290681280), 22:24:23–22:28:33, **passed** (secret scan of 193 files, dependency audit, 8 migrations and an idempotent repeat, 156/156, 24/24, build, 29/29) |
| 22:28:49–22:28:53 | Diff reviewed (client, tests and records; no reload, storage or external URL); `gh pr merge 23 --merge` | `937baac` on `dev`; its tree equals the tested head `668fe04`; `main` unchanged |

The last two rows were added in S-19 from GitHub's records.

---

## S-19: Post-release roadmap plan; organizer navigation and scroll (K-706)

| Field | Record |
|---|---|
| **Start** | 2026-10-12 23:31:12 +04:00 (prompt 28: "run"); prompt 29 at 2026-10-13 00:04:46 ("EVENTFLOW — COMPLETE POST-RELEASE PRODUCT ENHANCEMENT ROADMAP") |
| **Cards** | K-704 → Done (PR #23); K-705 split; K-706 (new) → Review; K-707 to K-715 (new) |
| **Tools and model** | Claude Code 2.1.296, model `claude-opus-5-5`; the S-02 toolchain; Playwright with Edge |

**Activity:**

| Local time | Activity | Result |
|---|---|---|
| 23:31:21–23:31:29 | Prompt 28: the stack was already running (`/healthz` schema 8); the organizer page opened | — |
| 00:05:02 | Prompt 29: state confirmed on GitHub and locally | `dev` `937baac`, `main` `8e7f6c1`; PRs #21 to #23 merged; Node 24's built-in `crypto.argon2` is available (no native hashing package needed) |
| 00:05:18–00:05:48 | Read the organizer router; a scroll probe (scrolled page; every section, Refresh, back and forward) at 1440 and 390 px | Every section change jumped to the top (`navigate()` called `scrollTo(0)`); on phones the check-in field's `autoFocus` then scrolled the tabs off screen |
| 00:06:31 | `feature/navigation-capacity` from `dev` (`937baac`) | — |
| 00:07–00:09 | Router scrolls only for a new view; `preventScroll` focus; the workspace keeps the tabs in place across section changes; a minimum height for the sections panel | Probe at 1440, 768 and 390 px: the tabs stay at the same place for every section, Refresh, back and forward |
| 00:09–00:10 | Sections opened once stay mounted while hidden; separate Participants and Waiting list instances; the hidden Staff section does not poll | Typecheck and lint pass |
| 00:10–00:14 | `navigation.spec.ts` (2) | Corrected in the test: two search fields shared a name (the waiting list's is now "Search the waiting list"), a status text matched a hidden copy, two measurements ran before rendering. **Mutation:** restoring the unconditional `scrollTo(0)` was not caught at first (the tab anchoring compensates on tab clicks); a link inside a section ("Meet your participants") was added, and the mutation then fails the test. 2/2 |
| 00:16 | Plan: [POST_RELEASE_PLAN.md](POST_RELEASE_PLAN.md) (PRs A to J, assumptions, map provider options); amendments A-1 approved, A-2 to A-6 recorded; cards K-706 to K-715 | The map provider is the open decision |
| 00:16:21–00:22:57 | Full gates | `check:secrets`, `check:deps`, `format:check`, `lint`, `typecheck`, `migrate` ("schema is up to date"), `test` (server **156/156**, client **24/24**), `build` and `e2e` (**31/31**, Edge) exit 0 |
| 00:23:13–00:23:40 | Commits `b26e561` (client), `ce89584` (browser tests), `89ff78d` (records); pushed; [PR #24](https://github.com/DavidMalkhasyan/event-registration-system/pull/24) opened | CI [run 38303929361](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38303929361), 00:23:44–00:28:46, **passed** (secret scan of 195 files, dependency audit, 8 migrations and an idempotent repeat, 156/156, 24/24, build, 31/31) |
| 00:29:05–00:29:09 | Diff reviewed (client, browser tests and records only); `gh pr merge 24 --merge` | `0f5f5d8` on `dev`; its tree equals the tested head `89ff78d`; `main` unchanged |
| 00:29:13 | `feature/capacity-increase-only` from `dev` (`0f5f5d8`) | — |
| 00:29–00:31 | TX-E03 increase-only (409 `capacity_decrease_not_allowed` with the current capacity); `capacity.test.ts`: the decrease test and the decrease race rewritten for A-2, a range test added, the simultaneous-changes test now expects the highest value | 9/9. **Mutation:** the old "not below the confirmed count" rule fails the new decrease test; restored |
| 00:31–00:33 | `normalizeCapacity` (6 unit tests); creation and settings forms correct on leaving the field or submitting, refuse fractions, keep blank while editing; Save disabled while unchanged | Client 30/30; typecheck and lint pass |
| 00:33:33 | `capacity.spec.ts` (2): increase and promotion, a lower value set back, 250 000 → 100 000, a fraction refused, a direct API decrease 409; the creation form's corrections and a refused fraction | capacity, organizer-workspace and settings specs 6/6 |
| 00:34:49–00:41:31 | Full gates | `check:secrets`, `check:deps`, `format:check`, `lint`, `typecheck`, `migrate`, `test` (server **157/157**, client **30/30**), `build` and `e2e` (**32/32**, Edge) exit 0 |
| 00:41:51–00:42:08 | Commits `7110909` (server), `3f05f12` (client), `2656ee5` (browser tests), `c7de387` (records); pushed; [PR #25](https://github.com/DavidMalkhasyan/event-registration-system/pull/25) opened | CI [run 38305926846](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38305926846), 00:42:12–00:47:10, **passed** (secret scan of 197 files, dependency audit, 8 migrations and an idempotent repeat, 157/157, 30/30, build, 32/32) |
| 00:47:34–00:47:39 | Diff reviewed (TX-E03 refuses decreases under the event lock; forms normalize on commit; two tests rewritten for A-2); `gh pr merge 25 --merge` | `0fed928` on `dev`; its tree equals the tested head `c7de387`; `main` unchanged |
| 00:42–00:48 | Read the identity tables, every ownership check (12 inside event locks, 5 queries), the migration runner, the event lock and its retry policy (only serialization codes are retried, so an access error thrown inside the lock rolls back cleanly) | Design of PR C (PD-88) |
| 00:47:43 | `feature/organizations-model` from `dev` (`0fed928`) | — |
| 00:47–00:50 | Migration `0009` with a marked backfill; `assertEventAccess` and the membership helpers; all ownership checks and owner-based queries replaced; creation chooses the organization; the session lists memberships; transitional personal organization at passwordless sign-in | Typecheck found four now-impossible `'not_found'` comparisons; removed. Lint clean. Existing server suite on schema 9: **157/157** |
| 00:50–00:54 | `organizations.test.ts` (4): the migration's backfill section on legacy rows in a rolled-back transaction (twice, idempotent); cross-organization isolation on every endpoint family; two organizers of one organization, `organization_required`, creator recorded; inactive organizations lose organizer access while public registration continues | 4/4. **Mutation:** ignoring the organization status fails the inactive-organization test; restored |
| 00:54–00:55 | Client: the session's memberships, the organization and role in the shell, an organization choice in the creation form when there are several | Typecheck and lint pass |
| 00:55:31 | Migration `0009` on the **development database**, counted before and after | Before: 7 accounts, 34 events, 61 registrations, 46 tickets, 6 staff invitations, 30 audit records, 167 outbox messages, schema 8. After: the same counts, schema 9, **7 active organizations, 7 owner memberships, 0 events without an organization, 0 events whose creator is not their organization's owner** |
| 00:55:46–01:02:42 | Full gates | `check:secrets`, `check:deps`, `format:check`, `lint`, `typecheck`, `migrate`, `test` (server **161/161** in 19 files, client **30/30**), `build` and `e2e` (**32/32**, Edge) exit 0 |
| 01:03 to 09:26 | The Claude Code session ended while writing PR C's records; the development processes stopped with it. Prompt 30 ("continue") at 2026-10-13 09:26:32 | The branch and its uncommitted work were intact |
| 09:26:58–09:28:01 | State checked after the restart (branch, uncommitted work, remote); PR C's records applied; checks; commits `5dcdf8e` (server), `fbde2ad` (client), `95d66ef` (records); pushed | — |
| 09:29:05–09:29:11 | [PR #26](https://github.com/DavidMalkhasyan/event-registration-system/pull/26) opened into `dev` | CI [run 38351624575](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38351624575), 09:29:14–09:33:18, **passed** (secret scan, dependency audit, 9 migrations and an idempotent repeat, 161/161, 30/30, build, 32/32) |
| 09:33:36–09:33:41 | Diff reviewed (one access helper inside every event lock; backfill tested on legacy rows; the transitional personal organization marked for removal); `gh pr merge 26 --merge` | `e5b3e73` on `dev`; `main` unchanged. GitHub's API rate limit was reached right after; later polling was spaced out |
| 09:33:41 | `feature/organization-accounts` from `dev` (`e5b3e73`) | — |
| 09:34–09:37 | Read the sign-in module, link routing, rate-limit rules, Origin enforcement and session constants; measured Node 24's built-in Argon2id (about 30 ms per hash at 19 MiB, 2 passes); migration `0010`; `passwords.ts`; `accounts.ts` (registration, verification, reset, password sign-in and re-authentication); routes, message types, rate limits, error codes | Typecheck passes |
| 09:38:09–09:38:18 | The server suite could not connect: PostgreSQL had stopped with the earlier session. Restarted with `pg_ctl` on port 54318 | No data lost (the development database kept its counts) |
| 09:38:31–09:42:23 | Server suite: **13 staff tests failed** (`claim_error` when the staff invitation was sent). Cause: `0010` rebuilt `access_tokens_ck35` from `0001`'s definition and lost the staff-invitation rule that `0006` had added. Rebuilt from `0006`'s definition | Suite **161/161** again |
| 09:45:43–09:46:35 | `accounts.test.ts` (13): registration without enumeration, verification, approval gate, password sign-in answers, reset (sessions ended, link single-use), the emailed link only for existing password-less accounts, Argon2id format, rate limits, re-authentication | First run: the re-authentication setup broke `organizer_sessions_ck12`; the test now back-dates the session's creation too. 13/13. **Mutation:** a reset that does not end sessions fails the test; restored |
| 09:47–09:49 | Client: password sign-in, organization registration, forgotten password, the emailed-link page for organizers without a password, the organization status page; `/verify-account` and `/reset-password` on the link entry. Browser helpers seed approved organizers in the test database | Typecheck and lint pass |
| 09:49:54–09:52:47 | `accounts.spec.ts` (2): registration, confirmation, awaiting approval, then (approval stood in for by the test database) the organizer workspace; identical answers for a wrong password and an unknown address; a reset signs the other browser out. Run with the affected specs | **6/6** (Edge) |
| 09:53:33–10:00:52 | Full gates; migration `0010` on the development database at 09:53:51 (91 ms) | `check:secrets`, `check:deps`, `format:check`, `lint`, `typecheck`, `migrate`, `test` (server **174/174** in 20 files, client **30/30**), `build` and `e2e` (**34/34**, Edge) exit 0. Development database after: schema 10; 7 accounts, all verified, none with a password; 7 organizations, 34 events, 61 registrations, 167 outbox messages (the counting query before the migration named the new column and failed; `0010` inserts and deletes no rows) |
| 09:54–10:01 | Self-review of the diff. Two fixes: password sign-in now re-reads the password hash under the address lock, so a sign-in racing a reset cannot create a session that outlives the reset; the verification email no longer says that signing in sends a new link (it points to "Forgot your password?", which also confirms the address) | `accounts` and `reauth` suites **25/25**, lint and typecheck pass. The race has no dedicated test (it needs two interleaved transactions); it is covered by review |
| 10:01:01–10:03:10 | PR D's records (PD-89, Kanban, schema, scope, README, journal); secret scan of 208 files; commits `c64f49f` (server), `fcedeb3` (client and browser tests), `a4d1ccb` (records); pushed; [PR #27](https://github.com/DavidMalkhasyan/event-registration-system/pull/27) opened at 10:03:17 | CI [run 38354610695](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38354610695), 10:03:20–10:08:40, **passed** (secret scan, dependency audit, 10 migrations and an idempotent repeat, 174/174, 30/30, build, 34/34) |
| 10:09:01–10:09:14 | Diff reviewed (Argon2id from Node's crypto module; identical answers with and without an account; a reset ends every session; sign-in re-checked under the address lock; existing organizers keep the emailed link); `gh pr merge 27 --merge` | `e0e0761` on `dev`; its tree equals the tested head `a4d1ccb`; `main` unchanged (`8e7f6c1`) |
| 10:03:22 | `feature/super-admin` from PR D's head `a4d1ccb` (the same tree as `dev` after the merge) | — |
| 10:03–10:06 | Migration `0011` (Super Admin tables, decision columns, audit actor, message type); `platform-admin` module: sign-in with its own cookie (SameSite=Strict), sessions and CSRF kind, the organization list with owners and counts, decisions under a row lock with audit and owner emails, an organization's history; the operator command `admin:create` / `admin:disable` (password without echo or on standard input, never as an argument); `organization_decision` emails | Typecheck and lint pass |
| 10:06–10:08 | `platform-admin.test.ts` (10) | First run 7/10: the command rejected an address with surrounding spaces (now normalized before validation, a real fix), and two tests assumed a 403 where the API answers 422 (an empty body) and 404 (reads of a suspended organization's event, as PD-88 defines); corrected. 10/10 |
| 10:08:19–10:08:42 | **Mutation:** decisions without the row lock | The concurrent-decisions test still passed: the two requests did not overlap. The test now holds the organization row in another transaction while both decisions start, so they really race; the mutant then fails with 200 and 200, and the restored code passes |
| 10:09–10:11 | Client: `/admin` as a fourth entry and bundle (sign-in, filters with counts, organization cards with owners, decisions with confirmation and required reasons, history); Vite entry and route; security-header test covers `/admin`, `/admin.html`, `/verify-account` and `/reset-password` | Typecheck and lint pass |
| 10:11:50–10:14:40 | `admin.spec.ts` (1): the operator command against the test database (and its refusal of an existing Super Admin), admin sign-in refusing organizer credentials, approval, a rejection that needs a reason, the history, both owners' emails, the approved organizer's workspace and the rejected one's status | Two test faults fixed: the API request needed the `Origin` header, and a second verification link that differs only in its `#fragment` does not reload the page (the test now opens a blank page first). **1/1** |
| 10:15:05–10:22:20 | Full gates; migration `0011` on the development database at 10:15:23 | `check:secrets`, `check:deps`, `format:check`, `lint`, `typecheck`, `migrate`, `test` (server **184/184** in 21 files, client **30/30**), `build` and `e2e` (**35/35**, Edge) exit 0. Development database before and after: the same 7 accounts, 7 organizations, 34 events, 61 registrations, 300 access tokens, 167 outbox messages and 30 audit records; schema 10 → 11 |
| 10:22–10:24 | Self-review: the decision update also requires the expected current state (a second guard beside the row lock) | `platform-admin` **10/10** again |
| 10:23:21–10:24:00 | PR E's records (PD-90, Kanban, schema, README with the operator command §2.4, journal); secret scan of 217 files; commits `893f5c0` (server), `19267a7` (client and browser test), `4b5f2c2` (records); pushed; [PR #28](https://github.com/DavidMalkhasyan/event-registration-system/pull/28) opened at 10:24:00 | CI [run 38356478467](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38356478467), 10:24:04–10:28:39, **passed** (11 migrations and an idempotent repeat, 184/184, 30/30, build, 35/35) |
| 10:30:45–10:30:51 | Diff reviewed (separate Super Admin identity and cookie; no route creates an admin; decisions under a row lock with a state guard, audited and emailed); `gh pr merge 28 --merge` | `61e8829` on `dev`; its tree equals the tested head `4b5f2c2`; `main` unchanged |
| 10:24:13 | `feature/event-location` from PR E's head `4b5f2c2` (the same tree as `dev` after the merge) | — |
| 10:24–10:26 | Migration `0012` (optional venue columns, coordinates, `location_version`, `venue_change` message type); `location.ts` (validation, views, `setLocation` under the event lock with a version guard and notices); the location in the organizer, public, management and ticket-share views and at creation; the `venue_change` email | Typecheck passes |
| 10:26:49–10:27:03 | `location.test.ts` (5): creation and display, coordinates only as given, server validation, notices to confirmed and waiting participants only, unchanged and coordinates-only saves send nothing, a stale version is refused, only the latest of two quick changes is sent, removal, other organizations, started and cancelled events | **5/5** on the first run |
| 10:27:50 | **Mutation:** a venue notice that ignores the location version | The "only the latest" test fails (two emails); restored |
| 10:28–10:32 | Client: `shared/location.tsx` (venue details with Get directions, OpenStreetMap and copy; the location form and its checks); creation form section; Settings location editor with confirmation; the venue on the public page, the management page and the shared ticket; `location.test.ts` (5) for the form checks and the links | Typecheck, lint, client **35/35** |
| 10:32:19–10:34:36 | `location.spec.ts` (1) | First run: the label "City" also matched "Capacity" (exact match now). Second run found a **real defect**: the settings form skipped the confirmation when its participant counts were stale (it said nobody would be emailed while the server queued one email); the form now always asks, as the reschedule form does, and reports the server's number. The test reloads before opening Settings, so the dialog's count is deterministic. **1/1** |
| 10:35:08 | Screenshots of the public page at 1440, 768 and 390 px, the creation form, Settings and the Super Admin sign-in | Venue card and actions wrap correctly at 390 px; no horizontal scrolling |
| 10:35:37–10:42:44 | Full gates; migration `0012` on the development database at 10:35:56 | `check:secrets`, `check:deps`, `format:check`, `lint`, `typecheck`, `migrate`, `build` and `e2e` (**36/36**, Edge) exit 0; **`test` failed: 188/189**. Development database before and after: the same counts (7 accounts, 34 events, 61 registrations, 167 outbox messages, 30 audit records); schema 11 → 12 |
| 10:42–10:44 | The failing test is the public-data guard of K-701: it lists the public event's fields exactly, and `location` is new. The venue is public by design (PD-91); the list now includes it, and the test also checks that an event without a venue shows `null` | Server **189/189** |
