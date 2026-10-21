---
name: linx-ship
description: Use when every task is done, verify passes and the review is clean — updates project knowledge, opens the GitHub PR or GitLab MR, watches CI until green, and hands the merge to the user.
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
4. **Description** → `<work>/<slug>/pr-<repo>.md`, in `docsLanguage`. Follow the repo's template when present
   (`.github/pull_request_template.md`, `.gitlab/merge_request_templates/Default.md`); otherwise: goal (2–3 lines
   from the spec) · main changes · path to `<work>/<slug>/` · the `verify:` line · open Low review items · how to
   test. Progress has `issue:` → add `Closes #<number>` (both GitHub and GitLab close the issue on merge).
5. **Open the PR/MR** into `<base>`:
   `node .linx/forge.mjs pr-create --title="<type>: <summary>" --body-file=<work>/<slug>/pr-<repo>.md`
   It returns the open PR/MR if one already exists. Forge `none`, or the CLI missing/logged out → give the user
   the file and the "new PR/MR" URL for the branch. Several repos: producer (backend/library) first; the
   consumer's description says "depends on <link>".
6. **CI:** `node .linx/forge.mjs ci-status --wait` (one call waits up to 9 minutes; call again while `pending`).
   - `failed` → `node .linx/forge.mjs ci-log` → find the cause (`linx-debug`), fix, verify, push, wait again.
   - `canceled` → usually replaced by a newer pipeline; check that the newest commit has one, else tell the user.
   - `manual` → the pipeline waits for a manual job; tell the user.
   - Infrastructure or flaky failure (runner, network, quota) → tell the user; retry at most once.
   - `none` after waiting → the project has no CI for this branch; say so (`linx init --ci` can add one).
7. Record `pr: <url>` and the CI result in progress; commit + push.
8. ⛔ **The user merges.** Never merge yourself. Never push to `<base>`. Review comments arrive later →
   `linx-review` (Receiving feedback), then back to step 6.
9. **After the merge** (`node .linx/forge.mjs pr-status` → `state: merged`): `<work>` outside the repo →
   `status: done`, commit + push.
