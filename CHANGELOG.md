# Changelog

## 0.2.0 — 2026-10-21
- GitHub & GitLab integration through `.linx/forge.mjs` (wraps `gh` / `glab`; JSON output): `info`, `issue`,
  `pr-create`, `pr-status`, `pr-comments`, `ci-status --wait`, `ci-log`.
- Issue → work item: `linx-start #123` uses the issue as requirements; PR/MR descriptions get `Closes #123`.
- `linx-ship` opens the PR/MR, waits for CI and fixes failures from the job logs; `linx-review` works through
  unresolved PR/MR threads; `linx-resume`/`linx-start` detect merged PRs/MRs.
- `linx init --ci`: GitHub Actions workflow or GitLab CI job (verify gate + `linx check`), with the toolchain
  detected from `.nvmrc` / Dockerfile / lockfiles. PR/MR templates created when missing.
- Progress gains `issue:` and `pr:` fields.

## 0.1.0 — 2026-10-21
- First public release: 11 `linx-*` skills, 3 subagents, Claude Code plugin + marketplace, `linx` CLI
  (`init`, `update`, `check`), verify gate with tsc/eslint/ruff baselines, session-start and post-edit hooks,
  config schema. Supports Claude Code, Cursor and `.agents/skills` (Codex and others).
