# Submission Checklist

**Status values:**
- **Done:** has evidence.
- **In progress:** started, but not complete.
- **Not started.**

Nothing is marked Done without evidence.

## 1. Assignment requirements

| # | Requirement | Status | Evidence or next step |
|---|---|---|---|
| 1 | GitHub repository containing the **working** project | **Done** | https://github.com/DavidMalkhasyan/event-registration-system. CI passed on GitHub (runs 38141682841, 38142263115); clean-clone verification passed (journal S-03). |
| 2 | Exact AI model and development tools, with a short rationale | **Done** | [AI_USAGE.md](AI_USAGE.md) §1–2 |
| 3 | Important prompts, decision logs, or a safely handled session export | **Done** | [AI_USAGE.md](AI_USAGE.md) §4 (prompts 1–9); [DECISION_LOG.md](DECISION_LOG.md) (PD-1 to PD-24). The transcript is not exported (PD-7). |
| 4 | Real incremental progress shown by Git commits and timestamped records | **Done** | Unrewritten history from `da80a85`; journal sessions S-01 to S-03, with times from Git and the session transcript |
| 5 | Clear setup and deployment instructions | **Done** | [README.md](../../README.md) §1–5, verified from a clean clone (S-03). Production deployment is out of scope (P2); a production-like single-origin run is documented and verified. |
| 6 | Accurate description of the current state | **Done** | [ASSIGNMENT_SCOPE.md](../../ASSIGNMENT_SCOPE.md); README §8 |
| 7 | Incomplete work and recommended next improvements | **Done** | README §8–9; ASSIGNMENT_SCOPE §3–4 |
| 8 | Attribution for reused templates, generators or third-party solutions | **Done** | [AI_USAGE.md](AI_USAGE.md) §7 |

## 2. Before every push

1. **Secret scan:** search for private keys, cloud and API keys, `re_…` (Resend), `whsec_…`, GitHub tokens, and `password=` / `secret=` assignments. The result must be none.
2. **No real `.env` file** is tracked; only `.env.example` with placeholders (added in `d6fec3a`).
3. **No session export, transcript or local path** (`C:\Users\…`) appears in tracked files.
4. **Personal data:** only example addresses in documents and fixtures.
5. **`git status`** is clean, and the journal entry for the session is committed.

## 3. GitHub remote (done in S-03)

1. The owner created the empty, public repository `DavidMalkhasyan/event-registration-system`.
2. The §2 checks were run over the **whole history**: clean.
3. `git remote add origin https://github.com/DavidMalkhasyan/event-registration-system.git`
4. `git push -u origin main` at 17:03:42 +04:00. The remote `main` was verified as `c45ecaf`.
5. Recorded in journal S-03.

## 4. Final submission (M6)

- [x] Every row in §1 is **Done**, with evidence.
- [x] CI is green on the submitted commit, and the setup passes from a clean clone (S-03). Recheck the final commit's run before submitting.
- [x] The README contains setup, run, a production-like run, current state, known limitations and incomplete work.
- [x] The journal covers every development session, with real timestamps and commit hashes.
- [x] AI usage and attribution are final.
- [x] The final secret scan is clean (full history, S-03).
- [ ] Release tag: optional; the owner decides.
