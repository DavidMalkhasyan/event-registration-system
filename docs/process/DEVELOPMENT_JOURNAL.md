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
| **End** | Recorded in the follow-up journal commit, below |
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
- **Process-documentation commit:** the six files in `docs/process/`.

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
