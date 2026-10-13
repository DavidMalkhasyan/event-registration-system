# AI Usage and Tooling

## 1. Environment (recorded, not assumed)

| Item | Value | Evidence |
|---|---|---|
| AI agent | **Claude Code**, in the VS Code extension | Session environment |
| Claude Code version | 2.1.295, then 2.1.296 (from S-02 to S-15) | Version metadata in the local session transcript; no other version appears in it (checked in S-15) |
| Model | **Claude Opus 5.5** (`claude-opus-5-5`), for every session S-01 to S-15 | Model ID on every assistant message in the transcript: 581 by the end of S-01, and every later message as well |
| Operating system | Windows 10 Enterprise 10.0.19045 | Session environment |
| Shells | Git Bash, Windows PowerShell 5.1 | Session environment |
| Git | 2.55.0.windows.3 | `git --version` (S-01) |
| GitHub CLI | 2.101.0. Used in S-03, with the owner's existing login, to inspect the empty repository and read the CI runs and logs. The push used plain `git`. | `gh --version`, `gh auth status` (S-03) |
| Python | 3.12.10, used only for documentation checks | `python --version` (S-01) |
| Validation libraries | `openapi-spec-validator` 0.7.1, PyYAML 6.0.2, and their dependencies, installed from PyPI into a temporary folder **outside the repository** | Session S-01 and the API-design phase |
| Container runtime | **None installed** (`docker` not found) | S-01 |
| Node.js | 24.21.0, portable zip in the user profile | `node --version`; zip checked against the official `SHASUMS256.txt` (S-02) |
| pnpm | 12.11.2 via corepack | `packageManager` in `package.json` |
| PostgreSQL | 18.6, portable EDB zip binaries in the user profile | `postgres --version`. EDB publishes no checksum, so the zip's SHA-256 was recorded: `fbe23da234ee31547bf8a36d29dfd81e82b849df2d2b78d2eecb43d360252f8c` |
| Browser for E2E | Microsoft Edge 155 (already installed), driven by Playwright 1.64.0 | Installed application folder; `pnpm add` output (S-02) |
| Python | Also used in S-02 to generate local secrets and to read timestamps from the session transcript for the journal; neither output is in the repository | S-02 |
| Vercel v0 | Used by the stakeholder, outside Claude Code, to create the approved visual design ([eventflow-v0-design](https://github.com/DavidMalkhasyan/eventflow-v0-design), first commit `ff4b60e` "Initial commit from v0", 2026-10-12). Claude Code only read that repository; it did not use v0 itself | v0 repository history (S-13) |
| ChatGPT | Used by the stakeholder, outside Claude Code, to help draft and review development prompts and decisions. **Source: the stakeholder's statement in S-15.** The repository and the Claude Code transcript contain no ChatGPT output, so they can neither confirm nor date which prompts it helped with | Stakeholder's S-15 prompt |

## 2. Why this model and tooling

- **Long, consistent context:** the work is requirements and design heavy. More than 180 acceptance criteria and 60 decision rounds had to stay mutually consistent, and a long-context model that follows detailed constraints suits that.
- **Edits done by tools, then verified:** an agent that edits files directly and runs verification scripts makes every change reviewable as a diff, and checks it mechanically instead of trusting its own reading.
- **Highest-capability model** for the design phase, where an error in the locking protocols or the token-security rules would be costly.
- **Human decisions throughout:** the stakeholder (the developer) approved, corrected or rejected every product, architecture and process decision. The AI proposed and implemented. See §5 for the AI errors that the checks or the stakeholder caught.

## 3. How AI is used, and the safeguards

| Activity | AI role | Safeguard |
|---|---|---|
| Requirements analysis and review rounds | Proposes wording and finds contradictions | Stakeholder approval per round (R1 to R60); document status stays "Proposed" |
| Architecture, database and API design | Drafts documents and decision options | Approval by decision ID; scripted consistency checks |
| Document edits | Scripted, exact-match replacements that abort if an anchor is missing | Diffs reviewed; checks rerun after every edit |
| Consistency checks | Writes and runs Python check scripts | Results recorded in the journal; scripts will be versioned in M1 (PD-6) |
| Version control | Runs `git` commands and writes commit messages | No backdating; `Co-Authored-By` trailer; owner identity |
| Implementation (S-02 to S-14) | Writes the code, migrations and tests; runs them | Every claim of success is backed by a recorded run (journal); mutation checks for key tests (for example the live count and the token bootstrap order); integration tests against real PostgreSQL; feature branches and pull requests into `dev` with green CI (since S-05); the stakeholder's quality gates (test, typecheck, runnable, record, commit) |
| UI redesign (S-13) | Ports the v0 design's visual components and styles onto the existing client | The real backend, states and security architecture were kept: no demo data store, no hash routing, no analytics or third-party scripts, no hosted fonts; all browser tests rerun |
| Prompts and decisions | Claude Code receives the stakeholder's prompts and proposes options | The stakeholder writes and sends every prompt and takes every decision; by the stakeholder's statement, some prompts and decisions were drafted or reviewed with ChatGPT first (§1) |

## 4. Prompts and session record

**The full transcript is not published (PD-7).** It is kept locally by Claude Code and covers 2026-10-09 08:58:55 UTC to the present. It contains the complete private conversation and local environment details.

Significant prompts, summarized in order. The stakeholder's own instructions are paraphrased; constraints are quoted where they matter.

| # | Prompt (summary) | Result |
|---|---|---|
| 1 | Act as senior business analyst and architect. Inspect the project and ask one clarification question at a time. "Do not write application code yet." | Q1 to Q10 |
| 2 | Review rounds with approvals, corrections and "do not implement" constraints | R1 to R56; REQUIREMENTS.md v1.0 to v1.4 |
| 3 | Phase 1 architecture blueprint, followed by approvals of ADR-002, 011, 012, 013, 021 with clarifications | docs/architecture, docs/adr; R57, R58 |
| 4 | Database design proposal, then corrections on time semantics, crash safety, hashing, budget configuration and stale messages | docs/database; R59 |
| 5 | API design and OpenAPI 3.1, then API-D1 to API-D10 with changes | docs/api; ADR-010, ADR-017 |
| 6 | Finalize R60, initialize Git, set up Kanban and milestones, AI transparency. "Do not fabricate historical timestamps, Git commits, test results or AI tool usage." | Session S-01: commits `da80a85`, `3fe9cb7` and the process documents |
| 7 | "We are starting implementation NOW": 5 days; approved stack (Node 24, pnpm, TypeScript, Fastify, React and Vite, PostgreSQL 18, Kysely, Vitest, GitHub Actions); vertical slices with real PostgreSQL and tests; autonomy for routine decisions. "Do not attempt to generate the entire application in one unverified batch." | S-02: toolchain, migrations, server, integration tests |
| 8 | "FINAL DELIVERY STRATEGY": the P0 list of 15 mandatory features plus general requirements; P1 and P2 only afterwards; ASSIGNMENT_SCOPE.md traceability; quality gates after each feature; "Do not fabricate progress or test outcomes", "Do not present deferred features as implemented", "Do not claim integration tests passed if PostgreSQL was unavailable". | S-02: client, quality gates, CI, E2E, README, ASSIGNMENT_SCOPE.md |
| 9 | "Final submission validation": publish to the given repository, inspect the real CI results, verify from a clean clone by following the README exactly, re-check the assignment evidence. "Do not report CI as passing until the actual remote workflow passes." No new features; no history rewriting. | S-03: push, two green CI runs, clean-clone verification, two README fixes |
| 10 | "Continue development according to our EXISTING project plan … NEXT TASK: K-404b": a feature branch, integration and concurrency tests, then name the next task | S-04: K-404b on `feature/k-404b-cutoff-job` |
| 11 | "CONTINUE EXISTING … DEVELOPMENT": branching strategy (`main`, `dev`, `feature/*`, `fix/*`); publish K-404b as a pull request into `dev`, verify the real CI and merge; database safety across branches; then K-304a (capacity changes) with integration, concurrency and browser tests and a pull request into `dev`. "Do not begin event cancellation until [re-authentication] is addressed." | S-05: PR #1 merged into `dev`; K-304a |
| 12 | "CONTINUE THE EXISTING … ROADMAP": merge PR #2 into `dev`; implement K-304b (FR-EVT-5, AC-105) with integration and browser tests and a pull request into `dev`, merging once green and reviewed; then assess the re-authentication needed for K-304c and **stop before implementing it**. | S-06: PR #2 merged; K-304b; the K-304c assessment |
| 13 | "DECISION APPROVED — IMPLEMENT RE-AUTHENTICATION FIRST": record K-304b as Done; implement K-302b following FR-ORG-5, AC-149 and ADR-010, with integration tests (boundary, race, second device, no action), a browser test using controlled test-database setup and no backdoors; a pull request into `dev`, merged when green; then plan K-304c without implementing it. | S-07: K-302b; the K-304c plan |
| 14 | "K-304c EVENT CANCELLATION — DECISIONS APPROVED": D1–D7; implement cancellation per FR-EVT-9, BR-16, BR-23 and TX-E05 with 21 listed test cases (forced orders, no sleep-only concurrency), browser tests for fresh and stale sessions, a pull request into `dev`; then K-304d only if its requirements are sufficiently resolved. | S-08: K-304c; the K-304d readiness check |
| 15 | "CONTINUE OUR EXISTING … DEVELOPMENT": do not merge `dev` into `main`; record K-304d Done; implement K-405 (FR-SELF, FR-LNK, FR-ROT, FR-SHR) with integration, concurrency, rollback and no-raw-token tests, browser tests and a pull request into `dev`; then K-406 staff invitations and sessions in a separate pull request, including the K-304c dependency. | S-10: K-405; S-11: K-406 |
| 16 | "CONTINUE THE EXISTING EVENT REGISTRATION SYSTEM ROADMAP": do not merge `dev` into `main`; close K-406 with its merge evidence; implement K-306 check-in undo (owner only, exclusive lock, audit, single active check-in, live count, share view) with integration, concurrency and browser tests and a pull request into `dev`; then waiting-list removal (TX-W01) in a separate pull request; then a frontend inventory for a later UI redesign, without starting the redesign. "Do not fabricate test results." | S-12: K-406 closed; K-306 |
| 17 | "IMPLEMENT THE APPROVED V0 DESIGN IN OUR EXISTING EVENT REGISTRATION SYSTEM": clone the v0 design into a sibling directory, inspect it, close K-506, correct K-403, then redesign organizer, participant and staff interfaces on the real backend, preserving every security guarantee and test; never fabricate data, results or access. | S-13: the v0 repository required a v0 login (`401`); reported, no credentials requested |
| 18 | "THE V0 DESIGN IS NOW AVAILABLE ON GITHUB": the same task from the GitHub copy; use the design, not the prototype's architecture (demo store, hash routing, StrictMode on link pages, analytics, Next.js). | S-13: K-507 in two pull requests |
| 19 | "FINAL SECURITY HARDENING AND RELEASE READINESS": the stakeholder approved fixing PD-71; guarantee the bootstrap order in the production bundle with an automated proof, implement FR-LNK-8 headers with HTTP tests, test camera scanning without claiming hardware, add K-105 checks, verify a clean setup, update the records; no merge into `main`, no tag, no submission. | S-14 |
| 20 | "FINAL DOCUMENTATION AUDIT AND RELEASE PREPARATION": K-001 approved for the R60 synchronization only, K-605 approved, K-004 not yet approved; correct the submission checklist, scope, README and milestones to the current state; attribute the v0 design and disclose ChatGPT use "where supported by the actual project history"; review the image provenance and report uncertainty instead of inventing a licence; audit the documents for consistency without changing REQUIREMENTS.md; pull request into `dev` only. "Do not mark an action completed merely because it is planned." | S-15 |
| 21 | "FINAL RELEASE PREPARATION — APPROVED DECISIONS": K-004 and K-603 approved; record PR #15; remove the three AI-generated photographs and replace them with original CSS posters in the EventFlow style, with no image generation dependency or hosted images; review every screen at 1440, 768 and 390 px; run all gates; merge into `dev`; open, but do not merge, the release pull request `dev` → `main`; no tag, no submission. | S-16 |
| 22 | "FINAL RELEASE MERGE — AUTHORIZED": no documentation pull request before the merge; five checks (base and head, CI run, mergeability, clean tree), then `gh pr merge 17 --merge`; verify `main`, the seven migrations, the absence of the photographs and the CI run on the new `main` commit; no tag, submission or deployment. | S-16: merged as `cf804e2`; CI passed |
| 23 | "FINAL POST-RELEASE DOCUMENTATION SYNC": record PR #16, PR #17, the `main` commit and its CI; update the checklist, Kanban and stale release statements; documentation only; a pull request into `dev`, then a synchronization pull request into `main`, each merged only with green CI; no tag, submission or deployment. | S-16 |
| 24 | "run project" | S-17: the development stack was already running; the local `main` was fast-forwarded to the release |
| 25 | "ADDITIONAL REQUIREMENT — LIVE PUBLIC EVENT AVAILABILITY": show free seats, the waiting list or the closed state on the public page before registration and update it without a reload; inspect the SSE infrastructure and prefer polling if a public stream adds needless complexity; aggregate data only; keep the server authoritative; say that the place is determined at email confirmation; tests for ten listed cases; feature branch and pull request into `dev`. | S-17: K-701, PD-81 |
| 26 | "interapt and run again" | S-18: the development processes were stopped (children that outlived their task stopped by process ID) and started again |
| 27 | "EVENTFLOW — ORGANIZER UX FIXES AND REGISTRATION CANCELLATION": prefill and confirm the date change in the event time zone; remove the sign-in and "Careful changes" blocks without weakening re-authentication; one Cancel event action, deletion under More actions; organizer cancellation of one confirmed registration with a dedicated notice, FIFO promotion, audit and race tests; manual and automatic organizer refresh; three pull requests into `dev`; track images, galleries, addresses and maps separately. | S-18: K-702 (PR A); K-703 and K-704 follow |
| 28 | "run" | S-19: the development stack was already running the latest `dev` code; the organizer page was opened |
| 29 | "EVENTFLOW — COMPLETE POST-RELEASE PRODUCT ENHANCEMENT ROADMAP": organizer navigation without scroll jumps; increase-only capacity with normalized input; organizations with password accounts, approval by a Super Admin and migration of existing organizers; event photographs and gallery; event location and venue-change notices; a real participant map subject to a provider decision; staff experience review; pull requests A to J into `dev`; no tag, no release. | S-19: plan, K-706 (PR A) first |
| 30 | "continue" (after the Claude Code session restarted) | S-19: work resumed on PR C from the uncommitted branch; nothing was lost |
| 31 | "continue" (2026-10-13 14:17:59, after the Claude Code session restarted again) | S-19: no tool ran before the next prompt |
| 32 | "continue" (14:42:26) | S-19: PostgreSQL restarted, PR #32 merged, PR J (staff review and final review) implemented |
| 33 | "EVENTFLOW — PRODUCTION READINESS & RELEASE CANDIDATE" (2026-10-13 16:46): map provider option A, real email provider, security audit, media reliability, deployment, backups, end-to-end audit, performance, CI, release candidate report; no tag, release, deployment, submission or paid service without authorization | S-20: plan in POST_RELEASE_PLAN.md; cards K-717 to K-725; PR A (K-714) first |

**Context management:** Claude Code summarized earlier parts of the long session automatically to stay within the context window. Decisions taken before a summary were re-read from the documents and the transcript whenever exact wording mattered.

## 5. AI errors caught (examples)

Each was caught by a check or by the stakeholder, then corrected and recorded:
- A stale-wording check for R58 missed a differently phrased sentence (flow F11). It was fixed later, in R59.
- An early database proposal declared a `RESTRICT` foreign key as deferrable, which PostgreSQL doesn't allow, and relied on partial indexes to support cascades. Both were corrected in the database design.
- Check-in state was stored in two places. The stakeholder required a single authoritative source.
- The proposal mapped every link-route failure to the generic `404`. The stakeholder required honest `500`/`503` responses for infrastructure failures (API-D1).
- The first SSE wording claimed "zero updates after a revocation", which no implementation mechanism enforces. It was corrected in R60.
- One check script misreads transaction IDs such as `TX-R01` as requirement IDs. This known false positive is noted in the journal.

Caught during implementation (S-02), all by tests, typecheck or runtime checks before commit:
- **Ambiguous claim result:** the job-claim function returned the same value for "already claimed" and "event missing".
- **Test clock ignored:** due-work queries used the database clock directly, ignoring the test clock. The reminder tests exposed it.
- **Missing confirmation check:** the cancellation endpoint didn't require the explicit `{confirmed: true}` body that API-D4 demands.
- **Test isolation:** the mailbox was not cleared between tests, and the SSE test raced, firing the check-in before the second stream opened.
- **Duplicate ticket email:** resetting the test data deleted the fake provider's idempotency directory.
- **Wrong mailbox path:** the worker wrote email under `apps/server/var/` because relative paths were resolved from the package directory.
- **Double sign-in effect:** React StrictMode's doubled effects resolved a sign-in link twice (PD-19).
- **Over-strict lint rule:** the first ESLint layering rule wrongly forbade the composition layer from importing modules.
- **Verification-script bug (S-03):** the clean-clone walkthrough script picked an already-used sign-in email. It failed loudly; the script was fixed, and the application was unchanged.
- **Overstated decision-log entry:** a first draft claimed ADR-003, 016, 019 and 020 were "implemented in their recommended form". Checking the ADR index showed ADR-016 names no library and ADR-019 specifies Testcontainers, so the entry was corrected before commit.

## 6. Data handling

- No API keys, tokens, passwords or private keys exist in the repository. `pnpm check:secrets` runs before every push (SUBMISSION_CHECKLIST §2) and, since S-14, in CI.
- Email addresses in the documents are examples (`bob@x.com`).
- The commit author's real email address becomes public once the repository is pushed (PD-4).
- No session export is committed.

## 7. Attribution

| Item | Use | Notes |
|---|---|---|
| OpenAPI Specification 3.1, JSON Schema 2020-12 | Contract format | Open standards |
| RFC 9457 (Problem Details) | Error format | IETF standard |
| Mermaid | Diagram syntax in the documentation | Rendered by viewers; not bundled |
| Conventional Commits | Commit-message convention | Specification |
| `openapi-spec-validator` and its dependencies (`jsonschema`, `referencing`, and others), PyYAML | Local validation only; not distributed with the project | Third-party open-source packages from PyPI |
| Resend documentation | Provider behavior cited in REQUIREMENTS §12.1a | Vendor documentation |
| **Vercel v0 design** ([eventflow-v0-design](https://github.com/DavidMalkhasyan/eventflow-v0-design)) | The approved visual design (S-13, K-507, PD-65 to PD-70): its visual components, layout and CSS were **adapted** into `apps/client` (mainly `shared/styles.css` and the page components) | Only the design was taken. The prototype's Next.js app, demo data store, hash routing, StrictMode on link pages and `@vercel/analytics` were not used; the real backend integration, event states and security architecture were kept. The design repository has no licence, README or credits file; it is the stakeholder's own repository |
| Three photographs from the v0 design (formerly `apps/client/src/assets/art/*.jpg`) | Event artwork from S-13 (`1689c9b`, PD-70) to S-16 | **AI-generated** according to their embedded metadata: IPTC digital source type `trainedAlgorithmicMedia`, credit "Made with Google AI". No licence or terms were recorded for them, so they were **removed in S-16** (PD-79) and are not in the current tree or the production build. They remain in earlier commits, because the history is not rewritten. |
| Event poster artwork (`apps/client/src/shared/artwork.tsx`; poster styles in `shared/styles.css`) | Event artwork since S-16: six original CSS posters (geometric shapes and type in the EventFlow palette, chosen per event from its public ID; no image files) | Written in this project in the v0 design's palette and typography; no generator, image file or external resource |
| ChatGPT | Helped the stakeholder draft and review development prompts and decisions (§1) | Source: the stakeholder's statement (S-15). It did not write code into the repository, run code, tests or development tools, or make commits: every command, test run and commit in the record was made by Claude Code in this workspace or by GitHub Actions |
| npm packages (runtime) | Fastify, @fastify/cookie, @fastify/static, Kysely, pg, zod, Luxon, React, React DOM, qrcode, lucide-react (icons, ISC licence, added in S-13) | Open-source dependencies, declared in each `package.json` and locked in `pnpm-lock.yaml` |
| npm packages (development) | TypeScript, tsx, Vite, @vitejs/plugin-react, Vitest, jsdom, Testing Library, Playwright, ESLint, typescript-eslint, eslint-plugin-react-hooks, globals, Prettier | As above |
| PostgreSQL 18 (EDB binaries), Node.js 24 | Runtime platform | Not distributed with the project |

No starter kits or project generators were used for the application. The workspace, configuration files and application code were written in the sessions (from S-02), not generated by `create-vite` or a similar tool. The one external design source is the v0 design above: since S-13 the client's look follows it, re-implemented on this project's own client code.
