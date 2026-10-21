# Changelog

## 0.3.0 — 2026-10-21
- .NET support: detects a root `*.sln`/`*.slnx`, a root project, or the only `*.csproj`/`*.fsproj`/`*.vbproj`;
  generates `dotnet build` (`--no-incremental`), `dotnet format --verify-no-changes` and `dotnet test` steps.
- New `dotnet` baseline parser for MSBuild diagnostics: legacy warnings and format issues are baselined, so only
  new ones fail the gate.
- Format after edit with `dotnet format whitespace --folder`; the new `{relfile}` placeholder passes the
  repo-relative path.
- `--ci` for .NET: `actions/setup-dotnet` (from `global.json` or the target framework) on GitHub,
  `mcr.microsoft.com/dotnet/sdk:<version>` on GitLab.
- README: "Supported stacks" table.

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
