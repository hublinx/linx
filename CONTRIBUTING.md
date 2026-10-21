# Contributing

- Node ≥ 20, no dependencies. `npm test` must pass before every commit.
- Layout: `skills/` (agent skills), `agents/` (Claude Code subagents), `hooks/` (Claude Code hooks; also copied into
  projects), `runtime/verify.mjs` (copied into projects), `lib/` + `bin/` (CLI), `templates/`, `schema/`.
- Skills: folder name = frontmatter `name`; `description` starts with "Use …" and says *when* to use the skill;
  `SKILL.md` ≤ 80 lines, with longer material in sibling files. Keep them project-agnostic: anything
  project-specific belongs in `.linx/config.json` or the project's `AGENTS.md`.
- Files copied into projects (`runtime/`, `hooks/*.mjs`) must stay dependency-free, single-file and
  cross-platform (Windows, macOS, Linux).

## Release

1. Bump `version` in `package.json`, `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
   (a test enforces they match). Add a `CHANGELOG.md` entry.
2. `npm test`, commit, `git tag vX.Y.Z`, push with tags.
3. Optional npm release: `npm publish` (package `linx-sdlc`, command `linx`).
