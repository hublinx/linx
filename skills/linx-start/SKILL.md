---
name: linx-start
description: Use FIRST for every task in a project that uses linx — feature, bug, small change, a GitHub/GitLab issue to work on, or a question about the code. Loads the right context and picks the feature track or the small-task track.
---
# linx-start

1. **Config.** Read `.linx/config.json`; missing keys fall back to the defaults in `config.md` (this folder).
   No config at all → tell the user once that `linx-init` sets the project up, then continue with defaults.
   Below, `<work>` = `paths.work`, `<knowledge>` = `paths.knowledge`, `<base>` = `baseBranch`.
2. **Project rules.** Read the repo's `AGENTS.md` (and `CLAUDE.md`) if they are not already in context.
3. **Unfinished work?** Look for `<work>/*/progress.md` with `status: doing` or `blocked` whose `owner` is
   `git config user.name`. Found → ask the user whether to continue it → `linx-resume`.
   Items in `status: review` → `node .linx/forge.mjs pr-status --branch=<branch>`: merged → finish `linx-ship`
   step 9; new review comments or failed CI → mention them to the user.
4. **Issue as input.** The task names an issue (`#123`, an issue URL, "issue 123") →
   `node .linx/forge.mjs issue <ref>`. Its title, body and comments are the requirements: read them critically
   and ask about gaps. Slug: `<YYYY-MM-DD>-<number>-<short-title>`; record `issue: <url>` in progress (and spec).
5. **Context.** Read `<knowledge>/INDEX.md` if it exists, then open at most 2–3 relevant docs. A domain the task
   touches has no doc and the task is not a pure question → run `linx-learn` for it first (ask if it is large).
6. **Classify.**
   - **Small:** one repo, ≤ `smallTaskMaxFiles` files, and NO escalation trigger.
   - **Feature:** everything else.
   - **Escalation triggers** (`escalation` in config): force the feature track; stop and ask the user before
     touching that area. Defaults: schema/migrations/indexes, auth & permissions, money, shared API contracts,
     more than one repo.
7. **State the class and the reason** (1–2 sentences), then:
   - Feature → `linx-spec`.
   - Bug → `linx-debug`, then the small track (feature track if the fix hits a trigger).
   - Small → create `<work>/<YYYY-MM-DD>-<slug>/progress.md` from `../linx-execute/progress-template.md`
     (`track: small`) with a 1–5 task mini-plan inside it, then `linx-execute`.
8. **Pure question** (no code change): answer directly; create nothing under `<work>`.

**Forge commands** (`node .linx/forge.mjs`, GitHub via `gh`, GitLab via `glab`): `info`, `issue`, `pr-create`,
`pr-status`, `pr-comments`, `ci-status [--wait]`, `ci-log`. They print JSON. Errors about a missing or
logged-out CLI → tell the user (`gh auth login` / `glab auth login`) and continue without that step.

**Token economy:** prefer code-intelligence tools (code graph, LSP, symbol search) over grep when available;
never read a whole file over ~400 lines when you need one section; hand broad searches to the `linx-explorer`
agent when subagents are available.

**Other process skills** (e.g. superpowers) are welcome inside a step when a linx skill points to them, but the
linx skills define the workflow and its stop points (⛔) in this project.
