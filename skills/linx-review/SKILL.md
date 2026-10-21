---
name: linx-review
description: Use to review changes before shipping (and after each task with a risk) against the linx checklist plus project-specific items; also use when receiving review feedback.
---
# linx-review

**Who reviews:** the `linx-reviewer` agent when subagents are available (clean context — give it the diff range
and the spec/plan paths). Otherwise review yourself: `git diff origin/<base>...HEAD`.

**Checklist** — mark each item OK / N/A / Issue:
1. **Spec fit** — does what the spec/plan says; nothing missing; no unrequested extras.
2. **Correctness** — edge cases (empty, null, limits, concurrency, time zones); error paths handled.
3. **Authorization** — new endpoints, routes and actions have the right checks; nothing public by accident; data
   filtered by what the caller may see.
4. **Contracts** — producer ↔ consumer types match (names, types, nullability); renamed/removed fields: every
   usage found and updated; backward compatible or versioned.
5. **Money & numbers** — rounding, currency/units, accumulation; no equality on floats; no floats for money where
   the project uses integers/decimals.
6. **Data** — schema/index/migration compatible with existing data; no destructive change without explicit
   approval; delete semantics follow project rules.
7. **Security** — no secrets in code or logs; no tokens/passwords/PII logged; input validated; injection-safe
   (SQL/NoSQL/shell/HTML).
8. **Performance** — no N+1 queries, sequential awaits that could run in parallel, unbounded queries, or whole
   collections filtered in memory.
9. **Tests** — new tests assert real behavior (they fail without the change), not just execute code.
10. **Conventions** — the repo's `AGENTS.md` rules.
11. **Project items** — every entry in `review.checklist` of `.linx/config.json`.

**Record** under `## Review` in progress: issues by severity **High / Medium / Low**, each with `file:line`, a
concrete failure scenario and the fix. Fix all High and Medium (then re-verify) before `linx-ship`; Low → fix
or list in the PR description.

**Receiving feedback** (from the reviewer, the user or PR comments): check each point against the code before
changing anything; push back with evidence when it is wrong; ask when it is unclear; no performative agreement.
(Follow `receiving-code-review` if available.)
