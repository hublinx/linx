---
name: linx-debug
description: Use for any bug, failing test, error or unexpected behavior in a linx project — find the root cause and write a failing reproduction test before fixing anything.
---
# linx-debug

**No fix without a confirmed root cause.** (Follow `systematic-debugging` if available.)

0. **Work item:** `<work>/<YYYY-MM-DD>-fix-<slug>/progress.md` from `../linx-execute/progress-template.md`
   (`track: small`), unless one exists already.
1. **Reproduce.** Exact steps, input, expected vs actual, error/stack trace, environment.
   - UI: route + actions + network request/response (browser automation if available).
   - Backend: request + logs of the services involved + the data (read-only access to a dev database only).
   - Not enough information → ask the user for the specific missing piece. Never guess-fix.
2. **Failing test first** that reproduces the bug and fails for the right reason. Not testable → record manual
   reproduction steps in progress.
3. **Root cause.** Trace back from the symptom to where the bad value or state is created, not where it crashes.
   One hypothesis at a time, each checked with evidence. Record 1–2 sentences + `file:line` under `## Decisions`.
   Three failed fix attempts → stop and discuss the design with the user.
4. **Fix** via `linx-execute` (small track), or switch to the feature track if the fix hits an escalation
   trigger. The new test passes; nothing else breaks.
5. **Siblings:** search for the same pattern elsewhere; list hits in progress; fix them only if the user agrees.
