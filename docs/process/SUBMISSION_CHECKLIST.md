# Submission Checklist

**Status values:**

- **Done:** has evidence.
- **In progress:** started, but not complete.
- **Not started.**

Nothing is marked Done without evidence. A planned action is not Done.

**State described:** the integration branch `dev` at `cf35cbd` (2026-10-12), plus this documentation pass (S-15). The published `main` is still `8c1247d`, the S-03 release of the P0 scope; everything built after it (P1 features, the UI redesign, the release hardening) is in `dev` only.

## 1. Assignment requirements

| # | Requirement | Status | Evidence or next step |
|---|---|---|---|
| 1 | GitHub repository containing the **working** project | **Done** for `dev`; **not yet released to `main`** | https://github.com/DavidMalkhasyan/event-registration-system. Latest code CI on `dev`'s content: [run 38244890522](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38244890522) (PR #14, head `25e9ffc`, merged as `cf35cbd`): secret scan, dependency audit, format, lint, typecheck, 7 migrations on an empty database and a repeat run, **135/135** server integration tests, **11/11** client unit tests, build, **22/22** browser tests. `main` (`8c1247d`) last passed CI in [run 38142498731](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38142498731). |
| 2 | Exact AI model and development tools, with a short rationale | **Done** | [AI_USAGE.md](AI_USAGE.md) §1–3 |
| 3 | Important prompts, decision logs, or a safely handled session export | **Done** | [AI_USAGE.md](AI_USAGE.md) §4 (prompts 1–20, the whole project); [DECISION_LOG.md](DECISION_LOG.md) (PD-1 to PD-75). The transcript is not exported (PD-7). |
| 4 | Real incremental progress shown by Git commits and timestamped records | **Done** | Unrewritten history from `da80a85`; 14 merged pull requests into `dev`; journal sessions **S-01 to S-15** with times from Git and the session transcript |
| 5 | Clear setup and deployment instructions | **Done** | [README.md](../../README.md) §1–5. **Clean-clone verification repeated in S-14** (journal): a fresh clone and a newly initialized PostgreSQL 18 cluster; install, provisioning, 7 migrations and "schema is up to date", secret scan, format, lint, typecheck, 135/135 and 11/11, build, the production-like run (with the FR-LNK-8 headers checked) and 22/22 browser tests. The first clean clone was in S-03. No production deployment exists; it is out of scope (P2). |
| 6 | Accurate description of the current state | **Done** | [ASSIGNMENT_SCOPE.md](../../ASSIGNMENT_SCOPE.md) (audited in S-15); README §8 |
| 7 | Incomplete work and recommended next improvements | **Done** | README §8–9; ASSIGNMENT_SCOPE §3–5 |
| 8 | Attribution for reused templates, generators or third-party solutions | **Done**, with one open question | [AI_USAGE.md](AI_USAGE.md) §7: the v0 design, its AI-generated images and their **unestablished licence** (see §5 below), libraries, tools |

## 2. Before every push

1. **Secret scan:** `pnpm check:secrets` (tracked files; also in CI since S-14). The result must be "No secrets found".
2. **No real `.env` file** is tracked; only `.env.example` with placeholders (added in `d6fec3a`). The secret scan fails on a tracked `.env`.
3. **No session export, transcript or local path** (`C:\Users\…`) appears in tracked files. Last checked in S-15 with `git grep`: none.
4. **Personal data:** only example addresses in documents and fixtures.
5. **`git status`** is clean, and the journal entry for the session is committed.

## 3. GitHub remote (done in S-03)

1. The owner created the empty, public repository `DavidMalkhasyan/event-registration-system`.
2. The §2 checks were run over the **whole history**: clean.
3. `git remote add origin https://github.com/DavidMalkhasyan/event-registration-system.git`
4. `git push -u origin main` at 17:03:42 +04:00. The remote `main` was verified as `c45ecaf`.
5. Recorded in journal S-03. Since S-05, work goes through feature branches and pull requests into `dev` (PD-29).

## 4. Final submission (M6)

- [x] Every row in §1 has evidence (row 1: for `dev`; row 8: with the open image-licence question).
- [x] CI is green on the latest code change in `dev` (run 38244890522).
- [x] The setup passes from a clean clone of the current code (S-14).
- [x] The README contains setup, run, a production-like run, current state, known limitations and incomplete work.
- [x] The journal covers every development session (S-01 to S-15), with real timestamps and commit hashes.
- [x] Secret scan and dependency audit are clean in CI run 38244890522 ("No secrets found in 179 tracked files"; "No known vulnerabilities found").
- [x] AI usage and attribution are up to date (S-15).
- [ ] **Stakeholder review of K-004** (process documentation).
- [ ] **Licence of the three bundled AI-generated images** confirmed by the owner, or the images replaced by the CSS posters (§5).
- [ ] **Camera scanning on a physical device** (manual check; only simulated browser APIs are tested).
- [ ] **Release pull request `dev` → `main`**: CI green on its head, then merged — needs the stakeholder's authorization.
- [ ] **Release tag** (optional; the owner decides) — after the merge into `main`.
- [ ] **Submission** of the assignment — the owner's action, after the release.

## 5. Known limitations to state with the submission

- **Release state:** `main` still contains only the S-03 P0 release until the release pull request is merged.
- **Camera scanning:** tested with simulated camera and `BarcodeDetector` APIs (PD-74); never tried on a phone or with a real camera. Desktop Chromium on Windows and Linux has no `BarcodeDetector`, so the scan button appears only where the browser supports it; manual code entry always works.
- **Images:** the three photographs come from the v0 design and declare themselves AI-generated ("Made with Google AI"). No licence or terms for them are recorded in the design repository, so their reuse rights are **not established**.
- **Email:** only the fake provider exists; no real email is sent (Resend, webhooks and bounce handling are P2, deferred).
- **Not built:** email-address change (FR-ORG-6), link revocation lists, localization (English only, OQ-8), delivery budget and pausing, production deployment, performance testing.
- **Development server:** the Vite development server does not send the production page headers and injects its own client script; the production path (the web process serving the build) is the tested one (PD-71, PD-72).
- **Accepted design limitations:** browser history may keep a link's fragment (EC-97); email gateways may rewrite links (EC-98); AC-186 (c) (closure of a staff stream within 30 s without check-ins) has no automated test.
