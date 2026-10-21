---
name: linx-init
description: Use when setting up linx in a project, or updating its installed files to a newer version — creates .linx/config.json, the verify gate, the GitHub/GitLab bridge, CI and PR/MR templates, the AGENTS.md workflow section and the knowledge/work folders.
---
# linx-init

1. **Find the CLI.** Plugin or repo layout: `node "<this skill's base directory>/../../bin/cli.mjs"`. Not there
   (skills were copied into the project) → `npx -y github:hublinx/linx`.
2. **Preview:** `<cli> init --dry-run`. Add `--plugin` when these skills come from the Claude Code plugin (the
   plugin already provides skills, agents and hooks for Claude). Add `--tools=cursor,agents` if the team also uses
   Cursor or Codex. Add `--ci` when the repo has no CI running the checks yet. Show the user the summary;
   continue once they agree.
3. **Install** on a branch (`chore/linx-setup` from `origin/<base>`): the same command without `--dry-run`.
   Lines marked `manual` (e.g. an existing `.gitlab-ci.yml` with its own `include:`) → do that edit with the user.
4. **Tune `.linx/config.json` with the user** (reference: `../linx-start/config.md`):
   - `verify`: run `node .linx/verify.mjs` once. Legacy typecheck/lint errors → with the user's OK run
     `node .linx/verify.mjs --update-baseline` and commit `.linx/baseline/`.
   - `escalation` and `review.checklist`: the risky areas of this product, in plain sentences.
   - `paths`: a shared folder outside the repo when one product spans several repos.
   - `docsLanguage`, `baseBranch`, `forge` (self-hosted GitLab whose URL lacks "gitlab" → set `"gitlab"`).
5. **Forge:** `node .linx/forge.mjs info` → `installed` and `authenticated` must be true for issues, PR/MR and CI
   steps. Otherwise ask the user to install `gh` / `glab` and run `gh auth login` / `glab auth login`.
6. **AGENTS.md project section** (above the managed linx block): stack, layout, commands, conventions,
   "stop and ask" rules — short, from what you read in the repo. The user confirms.
7. **Optional:** `linx-learn` for the 1–2 core domains.
8. Commit `chore: set up linx`, push, open the PR/MR (`linx-ship` steps 4–6).

**Update to a newer version:** `<cli> update` — keeps the config, refreshes managed files, and skips any managed
file edited by hand unless `--force`. CI files and PR/MR templates are yours: never overwritten.
