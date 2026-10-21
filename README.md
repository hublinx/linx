# linx

**An AI-agent SDLC for any repository.** linx gives Claude Code, Cursor and Codex one disciplined way to work:

```
feature:  start → spec ⛔ → plan ⛔ → execute (test-first, task by task) → verify → review → ship ⛔
small/bug: start → mini-plan → execute → verify → review → ship ⛔          (⛔ = waits for your approval)
```

- **Resumable anywhere.** All work state lives in plain files (`spec.md`, `plan.md`, `progress.md`) that are
  committed and pushed after every task. Switch from Claude Code to Cursor when you run out of quota, change
  machines, or clear context; then say `linx-resume` and the agent picks up at the right task.
- **A real verify gate.** `node .linx/verify.mjs` runs your typecheck/lint/test/build and prints one line:
  `verify: PASS 4/4 in 83s`. Baselines let legacy code adopt it: only *new* tsc/eslint/ruff errors fail.
- **Knows when to stop.** Escalation triggers (schema, auth, money, shared contracts, multi-repo; configurable)
  force the full spec → plan track and an explicit stop-and-ask.
- **Project knowledge.** `linx-learn` writes domain docs (business rules with `file:line`) that agents read
  before touching code. Docs record the commit they were verified at, so stale docs are easy to spot.
- **Token-aware.** Cheap models for searching (`linx-explorer`), mid-size models for implementing
  (`linx-implementer`), the strongest model for spec/plan/review (`linx-reviewer`).

## Install

Pick one. All of them work per project. Settings live in the project's `.linx/config.json`.

### 1. Claude Code plugin

```text
/plugin marketplace add hublinx/linx
/plugin install linx@linx
```

Then, in each project: *"use linx-init"* (or `/linx:linx-init`). The agent previews the setup, installs it with
`--plugin` (skills, agents and hooks come from the plugin), and tunes the config with you.

### 2. CLI: Claude Code, Cursor, Codex (no plugin needed)

```bash
cd your-project
npx -y github:hublinx/linx init                 # Claude Code + whatever the repo already uses
npx -y github:hublinx/linx init --tools=all     # claude, cursor, agents (.agents/skills: Codex & others)
```

The CLI copies the skills into `.claude/skills`, `.cursor/skills` and/or `.agents/skills`, so everyone who clones
the repo gets the same workflow without installing anything.

### 3. Skills only

The `skills/` folder follows the standard Agent Skills layout, so skill installers such as
`npx skills add hublinx/linx` work too. Run `linx init` afterwards for the config, verify gate and AGENTS.md section.

## What `init` sets up

| Path | What | Owner |
|---|---|---|
| `.linx/config.json` | Base branch, forge, verify steps, escalation triggers, review checklist, paths | **you** (never overwritten) |
| `.linx/verify.mjs` | Verify gate | linx |
| `.linx/forge.mjs` | GitHub/GitLab bridge: issues, PR/MR, review comments, CI | linx |
| PR/MR template, CI (`--ci`) | `.github/…` or `.gitlab/…`, created only when missing | **you** |
| `.linx/baseline/` | Error baselines (after `--update-baseline`) | you |
| `.linx/hooks/` | Session-start reminder, post-edit formatter + sensitive-file warning (Claude Code) | linx |
| `.linx/lock.json` | Hashes of linx-managed files | linx |
| `.claude/skills`, `.cursor/skills`, `.agents/skills` | The `linx-*` skills | linx |
| `.claude/agents/` | `linx-explorer` (haiku), `linx-implementer` (sonnet), `linx-reviewer` (opus) | linx |
| `.cursor/rules/linx.mdc` | Always-on rule that starts the workflow in Cursor | linx |
| `AGENTS.md` | A managed "Development workflow (linx)" block; the rest of the file is yours | shared |
| `CLAUDE.md` | `@AGENTS.md` import | shared |
| `.claude/settings.json` | Hooks, `allow` for the verify gate, `deny` for reading `.env*` (merged, never replaced) | shared |
| `docs/linx/knowledge/INDEX.md`, `docs/linx/work/` | Knowledge index and work items | you |

Every key in `.linx/config.json` is documented in [`skills/linx-start/config.md`](skills/linx-start/config.md).
Editors get autocompletion from [`schema/config.schema.json`](schema/config.schema.json).

## Supported stacks

The workflow (skills, work state, review, GitHub/GitLab) works with **any** language: the agent only runs the
commands in `.linx/config.json`. What `init` sets up for you depends on the stack:

| Stack | Detected from | Verify steps | Baseline (only new errors fail) | Format after edit | `--ci` toolchain |
|---|---|---|---|---|---|
| **.NET** (C#, F#, VB) | root `*.sln`/`*.slnx`, root project, or the only `*.csproj`/`*.fsproj`/`*.vbproj` | `dotnet build`, `dotnet format --verify-no-changes`, `dotnet test` | build warnings/errors and format issues (`dotnet`) | `dotnet format whitespace --folder` | `actions/setup-dotnet` · `mcr.microsoft.com/dotnet/sdk` |
| **Node / TypeScript** | `package.json` | `tsc`, `eslint`, `test`/`build` scripts | `tsc`, `eslint-json` | prettier | `actions/setup-node` · `node:<version>` |
| **Python** | `pyproject.toml`, `requirements*.txt` | ruff, mypy, pytest | `ruff-json` | `ruff format` | TODO in generated file |
| **Go** | `go.mod` | `go vet`, `go test`, `go build` | — | `gofmt` | TODO in generated file |
| **Rust** | `Cargo.toml` | `cargo clippy`, `cargo test` | — | `rustfmt` | TODO in generated file |
| **Java** | `pom.xml`, `gradlew` | `mvn verify`, `./gradlew check` | — | — | TODO in generated file |
| Anything else | — | write them yourself | — | set `format` yourself | TODO in generated file |

.NET details:
- **SDK version:** taken from `global.json`, else the highest `<TargetFramework(s)>` in the projects, else `8.0`.
- **Build:** runs with `--no-incremental`, so every run reports all warnings. An incremental build skips
  up-to-date projects and would undercount.
- **Legacy code:** existing warnings and format issues go into the baseline
  (`node .linx/verify.mjs --update-baseline`); from then on, only new ones fail the gate.
- **Several projects but no solution:** no steps are generated; list them yourself in `.linx/config.json`.
- **GitLab CI:** the SDK image installs Node with `apt` before running the verify gate.

Other stacks: write the steps yourself, for example Ruby:

```json
"verify": [
  { "name": "lint", "cmd": "bundle exec rubocop" },
  { "name": "test", "cmd": "bundle exec rspec" }
],
"format": { "command": "bundle exec rubocop -a {file}", "extensions": [".rb"] }
```

## The skills

| Skill | When |
|---|---|
| `linx-start` | First, for every task: loads context, classifies small vs feature, routes |
| `linx-spec` | Feature: clarify → options → design → `spec.md` ⛔ |
| `linx-plan` | Approved spec → small tasks with test + verify command → `plan.md`, `progress.md` ⛔ |
| `linx-execute` | Each task: test first → implement → verify → commit → update progress → push |
| `linx-resume` | Continue unfinished work after switching tool, machine or context |
| `linx-debug` | Bugs: reproduce → failing test → root cause → fix |
| `linx-verify` | Before any "done": run the gate, record the `verify:` line |
| `linx-review` | Checklist review (auth, contracts, money, data, security, performance, tests + your items) |
| `linx-ship` | Knowledge update → PR/MR → wait for CI, fix failures → you merge ⛔ |
| `linx-learn` | Write or refresh a domain doc from the code |
| `linx-init` | Set up or update linx in a project |

linx works on its own. If you also use [superpowers](https://github.com/obra/superpowers), the linx skills point
to its `brainstorming`, `writing-plans`, `test-driven-development`, `systematic-debugging` and review skills
inside the matching steps.

## Daily use

```text
You:   Add CSV export to the orders list, filterable by date range.
Agent: (linx-start) Feature: it touches a shared API contract. → linx-spec … asks one question at a time …
       spec.md written and committed. Please review. ⛔
You:   Approved.
Agent: (linx-plan) 6 tasks … plan.md + progress.md committed. Run with subagents or inline? ⛔
…
Agent: (linx-ship) verify: PASS 4/4 in 91s · review clean · PR opened: <link> · CI green. Merge is yours. ⛔
```

Start from an issue instead: *"linx-start #123"*. When review comments arrive: *"handle the PR comments"*.

Out of quota halfway through? Open the repo in another agent and say **`linx-resume`**.

## Verify gate

```bash
node .linx/verify.mjs                       # all default steps
node .linx/verify.mjs --only=typecheck,lint
node .linx/verify.mjs --only=e2e            # steps with "default": false run only when named
node .linx/verify.mjs --update-baseline     # record current tsc/eslint/ruff errors as the baseline
```

## GitHub & GitLab

`.linx/forge.mjs` gives the agent one set of commands for both forges. It wraps `gh` / `glab`, which must be
installed and logged in (`gh auth login` / `glab auth login`). It works with self-hosted GitLab and GitHub
Enterprise.

| Command | Used for |
|---|---|
| `node .linx/forge.mjs info` | Which forge, is the CLI installed and logged in |
| `node .linx/forge.mjs issue 123` | **Issue → work item.** `linx-start #123` reads the issue (title, body, comments) as the requirements. The PR/MR gets `Closes #123` |
| `node .linx/forge.mjs pr-create --title=… --body-file=…` | Opens the PR/MR into the base branch, or returns the one already open |
| `node .linx/forge.mjs pr-status` | open / merged / closed, review decision, CI summary (resume and post-merge steps) |
| `node .linx/forge.mjs pr-comments` | Unresolved review threads (`path:line`), reviews and comments, which the agent then works through |
| `node .linx/forge.mjs ci-status --wait` | Waits for the pipeline of the pushed commit: `success` / `failed` / `canceled` / `manual` / `none` |
| `node .linx/forge.mjs ci-log` | Tail of the failed jobs' logs, so the agent can fix and push again |

The agent never merges, and never posts review replies unless you ask. Replies are drafted in the work folder.

### CI

```bash
npx -y github:hublinx/linx init --ci
```

- **GitHub:** `.github/workflows/linx.yml` runs the verify gate and `linx check` on every PR and on pushes to the
  base branch.
- **GitLab:** `.gitlab/ci/linx.yml` holds the job. It is included from `.gitlab-ci.yml` (created if missing). An
  existing file is edited only when that is safe; otherwise linx tells you the one line to add.
- The toolchain is detected: the Node version comes from `.nvmrc`, `.node-version`, the Dockerfile `FROM node:…`
  or `engines`, and npm, yarn (classic or berry), pnpm and bun are supported. Run CI on the same Node version as
  production.
- PR/MR templates (`.github/pull_request_template.md`, `.gitlab/merge_request_templates/Default.md`) are created
  when the repo has none.
- CI files and templates are yours: linx never overwrites them. Create baselines from an LF working copy, the
  same line endings CI sees.

## Updating

```bash
npx -y github:hublinx/linx update        # refresh managed files; your config and AGENTS.md text stay
npx -y github:hublinx/linx update --force  # also overwrite managed files you edited by hand
```

Plugin users: `/plugin marketplace update linx`, then run `update` for the project files.

## Multi-repo products

Point `paths.work` and `paths.knowledge` at a shared folder next to the repos, e.g.
`"../product-workspace/work"`, and list the sibling repos under `repos`. Specs and progress then span all
repos, and each repo gets its own branch and PR/MR, opened producer first.

## Uninstall

Delete `.linx/`, the `linx-*` folders under `.claude/skills`, `.cursor/skills`, `.agents/skills` and
`.claude/agents`, `.cursor/rules/linx.mdc`, the `linx:begin … linx:end` block in `AGENTS.md`, and the
`.linx/hooks` entries in `.claude/settings.json`.

## Contributing

`npm test` (Node ≥ 20, no dependencies). See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. Workflow ideas build on [obra/superpowers](https://github.com/obra/superpowers) (MIT).
