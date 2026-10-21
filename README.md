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
/plugin marketplace add OWNER/linx
/plugin install linx@linx
```

Then, in each project: *"use linx-init"* (or `/linx:linx-init`). The agent previews the setup, installs it with
`--plugin` (skills, agents and hooks come from the plugin), and tunes the config with you.

### 2. CLI: Claude Code, Cursor, Codex (no plugin needed)

```bash
cd your-project
npx -y github:OWNER/linx init                 # Claude Code + whatever the repo already uses
npx -y github:OWNER/linx init --tools=all     # claude, cursor, agents (.agents/skills: Codex & others)
```

The CLI copies the skills into `.claude/skills`, `.cursor/skills` and/or `.agents/skills`, so everyone who clones
the repo gets the same workflow without installing anything.

### 3. Skills only

The `skills/` folder follows the standard Agent Skills layout, so skill installers such as
`npx skills add OWNER/linx` work too. Run `linx init` afterwards for the config, verify gate and AGENTS.md section.

## What `init` sets up

| Path | What | Owner |
|---|---|---|
| `.linx/config.json` | Base branch, forge, verify steps, escalation triggers, review checklist, paths | **you** (never overwritten) |
| `.linx/verify.mjs` | Verify gate | linx |
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
| `linx-ship` | Knowledge update → PR/MR (`gh` / `glab`) → you merge ⛔ |
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
Agent: (linx-ship) verify: PASS 4/4 in 91s · review clean · PR opened: <link>. Merge is yours. ⛔
```

Out of quota halfway through? Open the repo in another agent and say **`linx-resume`**.

## Verify gate

```bash
node .linx/verify.mjs                       # all default steps
node .linx/verify.mjs --only=typecheck,lint
node .linx/verify.mjs --only=e2e            # steps with "default": false run only when named
node .linx/verify.mjs --update-baseline     # record current tsc/eslint/ruff errors as the baseline
```

## CI

```yaml
# GitHub Actions
- run: node .linx/verify.mjs --skip=build
- run: npx -y github:OWNER/linx check     # fails if linx-managed files were edited by hand
```

```yaml
# GitLab CI
verify:
  script:
    - node .linx/verify.mjs --skip=build
    - npx -y github:OWNER/linx check
```

Run CI on the same Node version as your production image, and create baselines from an LF working copy (the
same line endings CI sees).

## Updating

```bash
npx -y github:OWNER/linx update        # refresh managed files; your config and AGENTS.md text stay
npx -y github:OWNER/linx update --force  # also overwrite managed files you edited by hand
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
