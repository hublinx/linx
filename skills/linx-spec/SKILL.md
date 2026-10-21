---
name: linx-spec
description: Use when linx-start classifies a task as a feature — turns the idea into a written spec the user approves before any planning or code.
---
# linx-spec

No code, no scaffolding, no plan until the user approves the spec.

1. **Understand.** Read the relevant code and knowledge docs first. Then clarify with the user **one question at
   a time** (multiple choice when possible): purpose, users, constraints, success criteria.
   (If the `brainstorming` skill — e.g. from superpowers — is available, follow it for this step.)
2. **Options.** Propose 2–3 approaches with trade-offs and a recommendation. Agree on one.
3. **Design in sections** (scope, interfaces, data, permissions, ...), confirming each section before the next.
4. **Write** `<work>/<YYYY-MM-DD>-<slug>/spec.md` from `spec-template.md` (this folder), in `docsLanguage`.
   Every section filled or explicitly "N/A — <why>".
5. **Self-review:** no TBD/TODO; no contradictions; every requirement testable; scope fits one plan
   (otherwise split into several specs and say so).
6. Commit `docs(<slug>): spec` in the repo that holds `<work>`; push.
7. ⛔ **STOP.** Ask the user to review and approve the spec. Changes requested → update, commit, ask again.
   Only after explicit approval → `linx-plan`.
