---
name: linx-learn
description: Use when a task touches a business domain that has no doc in the project's knowledge folder, or whose doc is stale — reads the code and writes a domain doc so agents understand the current logic.
---
# linx-learn

Input: a domain name (e.g. `orders`). Output: `<knowledge>/domains/<domain>.md` from `domain-template.md`
(this folder).

1. **Locate** (agent `linx-explorer` when available): modules/packages, models/schemas, DTOs/validators,
   permission checks, jobs/queues/events, API routes, UI screens/routes, tests. Put the paths/globs under
   `paths:` in the header (`<repo>:<path>` when several repos).
2. **Extract** — read only the sections you need: main entities and key fields; state flow (status enums and where
   transitions happen); business rules (validation, calculations, conditions); permissions; endpoint ↔ screen
   map; side effects (queues, notifications, webhooks, emails).
3. **Write** one line per rule + `file:line`. A rule inferred without an explicit reason in the code → append
   `⚠️ needs confirmation`. Keep it under ~200 lines; split large domains into `<domain>-<part>.md`.
4. **Header** `verified-at:` → `<repo>@<sha7>` for every repo read (`git rev-parse --short HEAD`).
5. Add or update `- [<domain>](domains/<domain>.md) — <one-line summary>` in `<knowledge>/INDEX.md`
   (create it from the layout `linx init` uses if missing).
6. Commit `docs(knowledge): learn <domain>` and push. Tell the user how many `⚠️` lines need confirmation.

**Stale check:** commits that touched the domain since it was verified —
`git rev-list --count <sha>..HEAD -- <paths>`. Ten or more → re-learn the changed parts.
