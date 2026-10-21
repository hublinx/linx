---
name: linx-ship
description: Use when every task is done, verify passes and the review is clean — updates project knowledge, opens the PR/MR (GitHub or GitLab) and hands the merge to the user.
---
# linx-ship

1. **Gate:** the latest `verify:` line in progress is a full PASS, and `## Review` has no open High/Medium.
2. **Knowledge** (part of this change, not an afterthought):
   - business rules added or changed → update `<knowledge>/domains/*.md` (one line per rule + `file:line`) and
     bump its `verified-at`;
   - architecture decision → ADR `<knowledge>/decisions/NNNN-<slug>.md` (context, decision, consequences;
     ≤ 30 lines) + a line in `<knowledge>/INDEX.md`.
3. **Progress:** `<work>` inside the repo → `status: done` (the merge is the record); `<work>` outside →
   `status: review`. Commit + push.
4. **Open a PR/MR** for each repo with changes, into `<base>` (`forge` in config):
   - github: `gh pr create --base <base> --head <branch> --title "<type>: <summary>" --body-file <file>`
   - gitlab: `glab mr create --source-branch <branch> --target-branch <base> --title "<type>: <summary>"
     --description "$(cat <file>)" --remove-source-branch`
   - `none`, or the CLI is missing/unauthenticated: save the text as `<work>/<slug>/pr-<repo>.md` and give the
     user the "new PR/MR" URL for the branch.
   Description, in `docsLanguage`: goal (2–3 lines from the spec) · main changes · path to `<work>/<slug>/` ·
   the `verify:` line · open Low review items · how to test manually.
   Several repos: open the producer (backend/library) first; the consumer's PR says "depends on <link>".
5. Add the PR/MR link(s) to progress; commit + push.
6. ⛔ **The user merges.** Never merge yourself. Never push to `<base>`.
7. **After the merge** (the user says so, or a later session sees it via `gh pr view` / `glab mr view`):
   `<work>` outside the repo → `status: done`, commit + push.
