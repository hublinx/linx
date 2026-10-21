---
name: linx-verify
description: Use before claiming any task is done, fixed or passing, and before every commit and PR/MR — runs the project's verify gate and records real evidence.
---
# linx-verify

**Evidence before claims.** Never say done / fixed / passing without running the gate in this session and reading
its output. (Follow `verification-before-completion` if available.)

- **Gate:** `node .linx/verify.mjs` (all default steps), or `--only=typecheck,lint`, or `--skip=build`.
  Steps come from `verify` in `.linx/config.json`.
- **No `.linx/verify.mjs`** (plugin installed but project not initialized): run each `verify[].cmd` from the
  config yourself; no config → run the project's own typecheck/lint/test/build commands and suggest `linx-init`.
- **Record only** the summary line (`verify: PASS 4/4 in 83s`) and the failing part in progress / PR text —
  never the full log.
- **FAIL caused by the change** → fix the code. **FAIL caused by the environment** (missing dependencies, service
  down) → fix the environment and rerun; if you can't, record `verify: BLOCKED <reason>` and tell the user.
  BLOCKED is not PASS.
- **Baselines:** steps with `baseline` fail only on new errors versus `.linx/baseline/`. **Never** run
  `--update-baseline` to get through the gate — only when the user asks (e.g. after reducing legacy errors).
- **Opt-in steps** (`"default": false`, e.g. e2e) run only via `--only=`. Run them when the change touches a
  critical flow; if impossible, record `e2e not run: <reason>`.
- **A new test passed on its first run?** Prove it can fail (temporarily break the code or the assertion);
  otherwise it proves nothing.
