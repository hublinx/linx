---
name: linx-execute
description: Use when carrying out tasks from a plan.md or a small-task mini-plan — test first, verify, commit, and update progress.md after every task so the work can resume on any machine or agent.
---
# linx-execute

**Before the first task:** read `plan.md` (or the mini-plan) and `progress.md`. In each repo involved, create
`feat/<slug>`, `fix/<slug>` or `chore/<slug>` from `origin/<base>` if it does not exist yet; record it under
`branches:` in progress.

**Each task:**
1. `progress.md`: mark the task `doing`; set `status: doing` and `updated:` (date, agent/tool, machine).
2. **Test first** where the repo has test infrastructure: write the test, run it, watch it fail for the right
   reason, then implement until it passes (follow `test-driven-development` if available). Not testable (pure
   markup, config) → write the reason in progress.
3. Implement exactly the task, following the plan and the repo's `AGENTS.md`. No drive-by refactors.
4. `linx-verify` with `--only=` the relevant steps.
5. Task `risk` other than `none` → `linx-review` for this task alone (agent `linx-reviewer` when available).
6. Commit the code (Conventional Commits, e.g. `feat(orders): add export endpoint`); push the branch.
7. `progress.md`: task `done`, its `verify:` line, decisions taken (one line each, with the why). Commit + push
   (in the repo holding `<work>`).
8. Context may now be cleared — all state is in files and git.

**Subagents available** (e.g. Claude Code): `risk: none` tasks may go to the `linx-implementer` agent — one task
per agent, given the task text plus the spec excerpt it needs. Read its report and diff before marking the task
done. Otherwise run tasks inline, in order.

**After the last task:** full `linx-verify` → `linx-review` of the whole branch → `linx-ship`.

**Off-plan work, or an escalation trigger shows up:** stop. Set `status: blocked`, write the question under
`## Blocked`, commit + push, ask the user. Do not work around it.
