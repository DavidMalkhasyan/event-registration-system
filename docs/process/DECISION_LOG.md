# Decision Log

This file is the chronological index of every decision series, plus the **process decisions** (PD-n) that aren't recorded anywhere else. Product and design decisions keep their authoritative text in the documents listed below; this file doesn't repeat them.

## 1. Where decisions are recorded

| Series | Content | Authoritative record |
|---|---|---|
| Q1 to Q10 | Stakeholder answers to the initial clarification questions | [REQUIREMENTS.md §13](../../REQUIREMENTS.md#13-decision-log) |
| R1 to R60 | Review-round decisions (rounds 1 to 17) | [REQUIREMENTS.md §13](../../REQUIREMENTS.md#13-decision-log) |
| ADR-001 to ADR-021 | Architecture decisions (7 approved, 14 proposed) | [docs/adr/README.md](../adr/README.md) |
| D-1 to D-17 | Database-design decisions | [DATABASE_DESIGN.md §1](../database/DATABASE_DESIGN.md#1-decision-register) |
| API-D1 to API-D10 | API-design decisions | [API_DESIGN.md §1](../api/API_DESIGN.md#1-decisions) |
| PD-1 onward | Process decisions | This file, §3 |

## 2. Design phase (historical, before version control)

These decisions were made in one Claude Code session before Git existed. The only timestamp evidence is that session's local transcript, which runs from **2026-10-09 08:58:55 UTC to 2026-10-11 09:35 UTC** ([AI_USAGE.md](AI_USAGE.md) §4). Individual decisions are listed **in order, without timestamps**, because the order is supported by the documents but per-decision times are not recorded in them.

| Order | Phase | Decisions | Outcome |
|---|---|---|---|
| 1 | Requirements clarification | Q1 to Q10 | REQUIREMENTS.md created |
| 2 | Requirements review rounds 1 to 13 | R1 to R56 (including stack R51, locking R53, engineering standards R54, authentication R55, email provider R56) | Requirements v1.0 to v1.4 |
| 3 | Documentation cleanup and link transport | R57 (v1.4.1), R58 / ADR-011 (v1.5) | |
| 4 | Phase 1 architecture | ADR-002, 011, 012, 013, 021 approved; PostgreSQL 18 directive | docs/architecture, docs/adr |
| 5 | Database design | D-1 to D-16; R59 (v1.6) | docs/database |
| 6 | API design | API-D1 to API-D10; ADR-010, ADR-017 | docs/api |
| 7 | API alignment | R60 (v1.7); D-17 | Applied in session S-01, commit `3fe9cb7` |

The design documents first entered version control in commit `da80a85`, on 2026-10-11 at 13:35:25 +04:00.

## 3. Process decisions

| ID | Date and time (+04:00) | Decision | Decided by | Rationale |
|---|---|---|---|---|
| PD-1 | 2026-10-11 (S-01) | Kanban with milestones M0 to M6 and a 25% contingency buffer | Stakeholder | Assignment methodology |
| PD-2 | 2026-10-11 13:35:25 | Initialize Git locally on branch `main`; commit the existing documentation **unchanged** as the baseline before any further edit | Stakeholder instruction, executed in S-01 | Separates the pre-Git design output from new work |
| PD-3 | 2026-10-11 (S-01) | Conventional Commits; small, genuine commits; never backdate or split finished work artificially; AI-assisted commits carry a `Co-Authored-By` trailer naming the model | Stakeholder and agent | Transparency of AI assistance |
| PD-4 | 2026-10-11 13:35 | Use the developer's existing global Git identity (`David Malkhasyan`). The email address in it becomes public once pushed. | Existing configuration | No invented identity |
| PD-5 | 2026-10-11 13:35 | No `.gitattributes`, `.gitignore` or other configuration files yet. They're deferred to project initialization (K-102), because this task excluded configuration files. Consequence: Git line-ending warnings (the system Git configuration has `core.autocrlf=true`). | Agent, within instructions | Respect the task boundary |
| PD-6 | 2026-10-11 (S-01) | The documentation checks are ad-hoc Python scripts kept **outside** the repository, using `openapi-spec-validator` 0.7.1 and PyYAML 6.0.2 installed in a temporary folder. They will be versioned in M1 (K-104). | Agent | No code allowed in this task; the checks must still be reproducible later |
| PD-7 | 2026-10-11 (S-01) | The raw agent-session transcript is **not** published. The development journal, this decision log and the prompt summaries in AI_USAGE.md replace it. | Agent, per stakeholder rules | The transcript contains the whole private conversation and local environment details |
| PD-8 | Restated 2026-10-11 | PostgreSQL is the only stateful dependency. Redis is deferred until performance tests show a need. No speculative infrastructure. | Stakeholder (R51) | Simplicity for one developer |
| PD-9 | 2026-10-11 (S-01) | No GitHub repository is created by the agent. The owner creates it and the steps are documented (SUBMISSION_CHECKLIST §3). | Agent, per stakeholder rules | Account, name and visibility are the owner's decisions |

## 4. Decisions needed before implementation (open)

| ID | Question | Needed by | Recommendation |
|---|---|---|---|
| PD-Q1 | What is the submission deadline? | Scheduling milestones and contingency | Provide the date. Milestones then get calendar targets. |
| PD-Q2 | Which Node.js version? | K-102 | The Active LTS line at project start (Node.js 24 on 2026-10-11), pinned in the repository |
| PD-Q3 | Which package manager? | K-102 | pnpm (workspaces) or npm (no extra install); pnpm recommended for the monorepo |
| PD-Q4 | CI platform (OQ-14), scanning tools and the failure threshold | K-103 | GitHub Actions, since the repository will be on GitHub; built-in dependency and secret scanning where available |
| PD-Q5 | GitHub repository name, account, visibility and licence | K-005 | The owner decides; a private repository until submission if the course allows |
| PD-Q6 | Container runtime for Testcontainers (Docker is not installed) | M2 | Install Docker Desktop (or Podman), or accept database tests in CI only |
| ADR-018 | Migration tool | M2 | A minimal in-repository runner (MIGRATIONS_STRATEGY §2) |
| ADR-003, 016, 019, 020 | Typed transactions, time library, test architecture, configuration | M1 to M3 | Approve before the dependent cards start |
| OQ-8 | Localization: language of the UI and emails | M3 to M5 (user-facing text) | Decide the MVP language before the first user-facing text |
