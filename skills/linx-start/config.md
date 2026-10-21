# `.linx/config.json` reference

Created by `linx init` (detected values), owned by the project — edit freely. Missing keys use these defaults.

| Key | Default | Meaning |
|---|---|---|
| `baseBranch` | `origin/HEAD`, else `main` | Branch to start work from and to target PRs/MRs at. |
| `forge` | from the `origin` URL | `github` (uses `gh`), `gitlab` (uses `glab`, incl. self-hosted) or `none`. Drives `.linx/forge.mjs`: issues, PR/MR, review comments, CI. |
| `docsLanguage` | `English` | Language for spec, plan, progress and PR/MR text. Code, identifiers and commit messages stay English. |
| `paths.work` | `docs/linx/work` | Work items: `<YYYY-MM-DD-slug>/{spec,plan,progress}.md`. May point outside the repo (e.g. `../team-workspace/work`) for multi-repo products. |
| `paths.knowledge` | `docs/linx/knowledge` | `INDEX.md`, `architecture/`, `domains/`, `decisions/`. |
| `smallTaskMaxFiles` | `5` | Above this many files a task is a feature. |
| `escalation` | see below | Areas that force the feature track and a stop-and-ask. |
| `verify` | detected | Steps for `.linx/verify.mjs` (see below). |
| `review.checklist` | `[]` | Extra project-specific review items, one sentence each. |
| `sensitivePaths` | `.env*`, key files | Regexes on repo-relative `/` paths. Editing a match makes the agent confirm and record why. |
| `format` | detected | `{ "command": "... {file}", "extensions": [".ts"] }` run after each edit (Claude Code hook). `{file}` = absolute path, `{relfile}` = repo-relative path. `null` = off. |
| `repos` | — | Multi-repo: `[{ "name": "api", "path": "../api" }]` — sibling repos a feature may touch. |

## Default `escalation`
- database schema changes, migrations, or index changes
- authentication, authorization, or permission logic
- money: pricing, payments, invoices, balances, payroll, commissions
- public or cross-service API contracts
- changes spanning more than one repository

Write project-specific ones as plain sentences, e.g. "anything under `src/billing/`", "feature flags in production".

## `verify` steps
```json
{ "name": "typecheck", "cmd": "npx tsc --noEmit --pretty false", "baseline": "tsc" }
{ "name": "e2e", "cmd": "npx playwright test", "default": false }
```
- `name` — used by `--only=` / `--skip=`.
- `cmd` — shell command run from the repo root; exit code 0 = pass.
- `baseline` (optional) — `tsc`, `eslint-json`, `ruff-json` or `dotnet` (MSBuild warnings/errors from
  `dotnet build`, and `dotnet format --verify-no-changes` issues). Errors are counted per file and only an increase
  over `.linx/baseline/<name>.json` fails. Lets legacy code adopt the gate without fixing everything first.
- `default: false` (optional) — skipped unless named in `--only=` (slow suites, e2e).
