# AI Usage and Tooling

## 1. Environment (recorded, not assumed)

| Item | Value | Evidence |
|---|---|---|
| AI agent | **Claude Code**, in the VS Code extension | Session environment |
| Claude Code version | 2.1.295, then 2.1.296 | Version metadata in the local session transcript |
| Model | **Claude Opus 5.5** (`claude-opus-5-5`) | Model ID on every one of the 581 assistant messages in the transcript |
| Operating system | Windows 10 Enterprise 10.0.19045 | Session environment |
| Shells | Git Bash, Windows PowerShell 5.1 | Session environment |
| Git | 2.55.0.windows.3 | `git --version` (S-01) |
| GitHub CLI | 2.101.0. Installed but **not used**; no remote has been created. | `gh --version` (S-01) |
| Python | 3.12.10, used only for documentation checks | `python --version` (S-01) |
| Validation libraries | `openapi-spec-validator` 0.7.1, PyYAML 6.0.2, and their dependencies, installed from PyPI into a temporary folder **outside the repository** | Session S-01 and the API-design phase |
| Container runtime | **None installed** (`docker` not found) | S-01 |

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
| Implementation (from M1) | Writes code and tests | Tests first for invariants; CI; human review |

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

**Context management:** Claude Code summarized earlier parts of the long session automatically to stay within the context window. Decisions taken before a summary were re-read from the documents and the transcript whenever exact wording mattered.

## 5. AI errors caught (examples)

Each was caught by a check or by the stakeholder, then corrected and recorded:
- A stale-wording check for R58 missed a differently phrased sentence (flow F11). It was fixed later, in R59.
- An early database proposal declared a `RESTRICT` foreign key as deferrable, which PostgreSQL doesn't allow, and relied on partial indexes to support cascades. Both were corrected in the database design.
- Check-in state was stored in two places. The stakeholder required a single authoritative source.
- The proposal mapped every link-route failure to the generic `404`. The stakeholder required honest `500`/`503` responses for infrastructure failures (API-D1).
- The first SSE wording claimed "zero updates after a revocation", which no implementation mechanism enforces. It was corrected in R60.
- One check script misreads transaction IDs such as `TX-R01` as requirement IDs. This known false positive is noted in the journal.

## 6. Data handling

- No API keys, tokens, passwords or private keys exist in the repository. A scan runs before every push (SUBMISSION_CHECKLIST §2).
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

No code templates, starter kits or generators have been used so far. Any used from M1 onward will be added here.
