---
name: linx-plan
description: Use after the user approves a spec — splits it into small tasks, each with a test and a verify command, and saves plan.md and progress.md.
---
# linx-plan

1. Write `<work>/<slug>/plan.md` from `plan-template.md` (this folder).
   (If the `writing-plans` skill — e.g. from superpowers — is available, follow it for task granularity.)
2. **Each task** is one focused change (roughly 2–15 minutes of work) and states:
   - `repo:` (multi-repo only) and the exact files to create/modify
   - `risk:` `none` or the escalation category it touches (`schema`, `permission`, `money`, `contract`, ...)
   - the test to write first (or why the task is not testable)
   - verify: `node .linx/verify.mjs --only=<steps>`
   - what "done" looks like
   Someone with no context must be able to execute a task from its text alone.
3. **Order:** shared contract/types → producer (backend, library) → consumer (frontend, clients) → UI.
   Each task leaves the build green.
4. Create `progress.md` from `../linx-execute/progress-template.md` (`track: feature`, `status: todo`) listing
   every task.
5. Commit `docs(<slug>): plan` + push.
6. ⛔ **STOP.** The user approves the plan and picks how to run it:
   - **subagents** (Claude Code): one `linx-implementer` per `risk: none` task, review between tasks;
   - **inline**, sequentially in this session (tools without subagents, e.g. Cursor, always run inline).
