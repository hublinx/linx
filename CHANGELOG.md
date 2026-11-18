# Changelog

## 0.4.1 — 2026-11-19
- `linx-lean`: reusing an endpoint built for another screen or feature now requires checking that its permission
  requirements (roles, scopes, guards) match the new caller; on a mismatch, use the endpoint the current screen
  already calls. Found in an A/B run where the lean variant reused a lookup endpoint restricted to a narrower scope
  than the screen, locking out some users.
- `linx-review`: the Simplicity item also checks permission parity of reused endpoints.

## 0.4.0 — 2026-11-18
- New `linx-lean` skill: the smallest complete change — YAGNI, reuse what exists, no unrequested abstractions,
  options or dependencies; never cuts validation, error handling, security or tests. Adapted from
  [ponytail](https://github.com/DietrichGebert/ponytail) v5.3.3 (MIT).
- MCP servers: `init`/`update` add CodeGraph and Playwright MCP to `.mcp.json` (Claude) and `.cursor/mcp.json`
  (Cursor) through a cross-platform launcher `.linx/mcp-run.mjs`; existing entries are never overwritten. Claude
  settings get `enabledMcpjsonServers` and `mcp__codegraph__*`. Choose with the new config key `mcp` (`[]` = none).
- AGENTS.md block: lean-code rule, CodeGraph before grep, Playwright for UI checks on local/dev servers only.
- `linx-review`: new Simplicity and UI checklist items.

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
