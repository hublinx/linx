# <Feature title> — plan

Spec: `spec.md` · Base branch: `<base>` · Branches: `<repo>=feat/<slug>`

## Global constraints
- <rules every task must respect: conventions, compatibility, performance limits>

## T1 — <short title>
- repo: <repo> · risk: none
- files: `path/to/file.ts` (modify), `path/to/new.test.ts` (create)
- test first: <behavior the test asserts; expected failure before the change>
- change: <what to implement, precise enough to do without the spec>
- verify: `node .linx/verify.mjs --only=typecheck,test`
- done when: <observable result>

## T2 — <short title>
- ...
