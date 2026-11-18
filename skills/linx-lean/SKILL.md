---
name: linx-lean
description: Use whenever you write or change code in a project that uses linx (feature, bug fix, refactor) and when reviewing a diff for over-engineering. Picks the smallest complete change — YAGNI, reuse what exists, no unrequested abstractions.
---
# linx-lean — the smallest complete change

The best code is the code never written. Solve the whole problem with the least new code.
The linx workflow (test-first `linx-execute`, the verify gate, escalation stop-and-ask) **wins** on any conflict.

## Before you write
Read the task and the code it touches (code graph before grep). List every place the change must reach: callers,
tests, fixtures, config, exports, producer ↔ consumer types. Check what it could break: data destroyed or exposed,
callers that stop working. That is scope. Extra features are not.

## Take the first option that fully works
1. Does it need to exist? Skip features, options and flexibility nobody asked for — name them in one line.
2. Already in this codebase (helper, component, service, pattern)? Use it the way the surrounding code does.
3. Standard library or platform feature? Use it, unless the project has its own.
4. An installed dependency? Use it. Never add a dependency for a few lines.
5. One line a reader gets at a glance? One line.
6. Otherwise: the minimum code that works.

- Lazy about the solution, never about the change: finish every caller, test and fixture the change breaks.
- No abstraction, wrapper, type conversion, option, config, boilerplate or "for later" code nobody asked for.
  Keep the structure the codebase already has. Deletion beats addition.
- The shortest working diff wins, once you know everything it must touch. A one-liner that needs decoding is not short.
- Comment only the why the code cannot show, in one line.
- Bug fix: find every caller of the function first, then fix the root cause once in the shared code.
- Code you move or merge keeps its error handling and validation.
- Between options of equal size, take the one that is correct on edge cases.
- Lean is not untested: tests follow `linx-execute`.
- A shortcut with a known limit gets a comment: `shortcut: <the limit>, <when to upgrade>`.

**Never cut:** validation at trust boundaries, error handling that prevents data loss, authorization and security,
accessibility, anything the user asked for.

## End of your reply
One or two lines: what you skipped or did not check, and any risk the user must know.

## Reviewing for over-engineering
For each hunk ask: what could be deleted with no change in behavior? Which abstraction, option or dependency did
nobody ask for? Does a helper already do this? Record findings by severity in `linx-review`.

Adapted from [ponytail](https://github.com/DietrichGebert/ponytail) v5.3.3 by Dietrich Gebert (MIT, see
`LICENSE-ponytail` in this folder).
