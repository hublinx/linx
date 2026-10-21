---
name: linx-resume
description: Use when continuing unfinished linx work — after switching agent or tool (Claude Code ↔ Cursor ↔ Codex), changing machine, running out of quota, or clearing context. Reads plan + progress and continues at the right task.
---
# linx-resume

1. **Find the work item:** the slug the user named, else `<work>/*/progress.md` with `status: doing|blocked`
   and your `owner`. `<work>` outside the repo → `git pull` that repo first.
2. **Branches:** for each repo in `branches:` — `git fetch`, check out the branch, `git pull`.
3. **Consistency check:** the last `done` task has a matching commit on its branch (`git log --oneline -15`).
   Mismatch → tell the user what you see; do not guess.
4. **Task in `doing`:**
   - uncommitted changes (`git status`, `git diff`) → re-read that task in `plan.md` and finish it;
   - no changes → start the task over.
5. **`status: blocked`:** re-read `## Blocked`; continue only once the user has answered (record the answer under
   `## Decisions`).
6. **Progress has `pr:`** (work already shipped): `node .linx/forge.mjs pr-status` → merged → `linx-ship` step 9;
   CI failed → `linx-ship` step 6; changes requested or new comments → `linx-review` (Receiving feedback).
7. Update `updated:` (date, agent/tool, machine), then continue with `linx-execute` from that task.

Read only `plan.md` + `progress.md` (+ the spec sections the task needs). Do not re-read the whole spec.
