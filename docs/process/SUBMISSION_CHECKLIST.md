# Submission Checklist

**Status values:**
- **Done:** has evidence.
- **In progress:** started, but not complete.
- **Not started.**

Nothing is marked Done without evidence.

## 1. Assignment requirements

| # | Requirement | Status | Evidence or next step |
|---|---|---|---|
| 1 | GitHub repository containing the **working** project | **In progress** | The project works locally: 23 integration, 3 unit and 4 E2E tests pass, and a smoke test passed (journal S-02). No remote yet (K-005, blocked on PD-Q5). |
| 2 | Exact AI model and development tools, with a short rationale | **In progress** | [AI_USAGE.md](AI_USAGE.md) §1–2, updated for S-02; finalize at submission |
| 3 | Important prompts, decision logs, or a safely handled session export | **In progress** | [AI_USAGE.md](AI_USAGE.md) §4 (prompts 1–8); [DECISION_LOG.md](DECISION_LOG.md) (PD-1 to PD-21). The transcript is not exported (PD-7). |
| 4 | Real incremental progress shown by Git commits and timestamped records | **In progress** | Commits `da80a85` to `b7a164f` and onward; journal S-01 and S-02 |
| 5 | Clear setup and deployment instructions | **In progress** | [README.md](../../README.md) §1–4. Not yet followed from a clean clone; no deployment target (P2). |
| 6 | Accurate description of the current state | **In progress** | [ASSIGNMENT_SCOPE.md](../../ASSIGNMENT_SCOPE.md); README §8 |
| 7 | Incomplete work and recommended next improvements | **In progress** | README §8–9; ASSIGNMENT_SCOPE §3–4 |
| 8 | Attribution for reused templates, generators or third-party solutions | **In progress** | [AI_USAGE.md](AI_USAGE.md) §7 (packages added in S-02; no templates or generators used) |

## 2. Before every push

1. **Secret scan:** search for private keys, cloud and API keys, `re_…` (Resend), `whsec_…`, GitHub tokens, and `password=` / `secret=` assignments. The result must be none.
2. **No real `.env` file** is tracked; only `.env.example` with placeholders (added in `d6fec3a`).
3. **No session export, transcript or local path** (`C:\Users\…`) appears in tracked files.
4. **Personal data:** only example addresses in documents and fixtures.
5. **`git status`** is clean, and the journal entry for the session is committed.

## 3. Setting up the GitHub remote (owner action; not done yet)

1. The owner creates an **empty** repository on GitHub, with no README, licence or `.gitignore`, to avoid an unrelated history. The name and visibility are decision PD-Q5.
2. Run the §2 checks.
3. `git remote add origin https://github.com/<owner>/<repository>.git`
4. `git push -u origin main`
5. Record the URL, the date and time, and the pushed commit hash in the journal. Mark K-005 Done only after the push is verified on GitHub.

No repository URL exists yet, and none is assumed anywhere in the documentation.

## 4. Final submission (M6)

- [ ] Every row in §1 is **Done**, with evidence.
- [ ] CI is green on the submitted commit; AC-142 passes from a clean clone.
- [ ] The README contains setup, run, deployment guidance, current state, known limitations and incomplete work.
- [ ] The journal covers every development session, with real timestamps and commit hashes.
- [ ] AI usage and attribution are final.
- [ ] The final secret scan is clean; the release is tagged.
