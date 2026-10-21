<!-- linx:begin — managed by `linx update`; change .linx/config.json instead of editing this block -->
## Development workflow (linx)

- Start every task with the `linx-start` skill. Feature: spec ⛔ → plan ⛔ → execute → verify → review → ship ⛔.
  Small task or bug: mini-plan → execute → verify → review → ship ⛔. (⛔ = wait for the user's approval.)
- Work state: `{{work}}/<YYYY-MM-DD-slug>/{spec,plan,progress}.md` — update, commit and push after every task so
  any agent, tool or machine can resume (`linx-resume`).
- Verify gate: `node .linx/verify.mjs` (or `--only=<steps>`). Never claim done before it passes.
- Branches: `feat/<slug>`, `fix/<slug>`, `chore/<slug>` from `origin/{{baseBranch}}` → PR/MR into `{{baseBranch}}`.
  Never push to `{{baseBranch}}` directly; never merge your own PR/MR.
- GitHub/GitLab: `node .linx/forge.mjs` — read issues, open PRs/MRs, read review comments, wait for CI
  (`ci-status --wait`) and read failed logs (`ci-log`). A PR/MR is shipped only when its CI is green.
- Knowledge: read `{{knowledge}}/INDEX.md` first, then only the relevant docs. Missing domain doc → `linx-learn`.
- Stop and ask the user before touching: {{escalation}}.
- Never read, write or commit secrets (`.env*`, keys, tokens). Use only read-only access to non-production data.
<!-- linx:end -->
