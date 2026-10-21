#!/usr/bin/env node
// linx CLI: set up, update and check the linx workflow in a project.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LOCK, TOOLS, VERSION, apply, check, plan } from '../lib/install.mjs';

const HELP = `linx ${VERSION} — AI-agent SDLC for any repo

Usage: linx <command> [options]

Commands:
  init      Set up linx in a project
  update    Refresh managed files (skills, agents, hooks, verify gate) to this version; keeps your config
  check     Exit 1 if managed files are missing or were edited by hand (for CI)

Options:
  --dir=<path>         Target project (default: current directory)
  --tools=<list>       ${TOOLS.join(',')} or all (default: claude + whatever the repo already uses)
  --plugin             The linx Claude Code plugin is installed: skip Claude skills/agents/hooks copies
  --no-plugin          Switch back to project-local Claude files
  --base=<branch>      Base branch (default: origin HEAD)
  --forge=<name>       github | gitlab | none (default: from the origin URL)
  --work=<path>        Work-state folder (default: docs/linx/work)
  --knowledge=<path>   Knowledge folder (default: docs/linx/knowledge)
  --ci                 Also generate CI: GitHub Actions workflow or GitLab CI job (verify gate + linx check)
  --dry-run            Show what would change; write nothing
  --force              Overwrite managed files that were edited by hand
`;

function parseArgs(argv) {
    const opts = { _: [] };
    for (const arg of argv) {
        const m = arg.match(/^--([\w-]+)(?:=(.*))?$/);
        if (!m) opts._.push(arg);
        else opts[m[1]] = m[2] ?? true;
    }
    return opts;
}

function summarize(actions) {
    const counts = {};
    for (const a of actions) counts[a.action] = (counts[a.action] ?? 0) + 1;
    const lines = [Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ') || 'nothing to do'];
    // Skill copies are numerous; list only what deserves a look.
    for (const a of actions) {
        const notable =
            a.action === 'conflict' ||
            a.action === 'manual' ||
            a.action === 'merge' ||
            a.action === 'remove' ||
            (a.action === 'create' && !/\/(skills|agents)\//.test(a.rel));
        if (notable) lines.push(`  ${a.action.padEnd(9)} ${a.rel}${a.note ? `  (${a.note})` : ''}`);
    }
    return lines.join('\n');
}

const NEXT = `
Next steps:
  1. Review .linx/config.json — verify steps, escalation triggers, review checklist, paths.
  2. Run: node .linx/verify.mjs
     Legacy errors? With your team's OK: node .linx/verify.mjs --update-baseline, then commit .linx/baseline/
  3. Fill the "Project" section of AGENTS.md (or ask your agent: "use linx-init" to do steps 1–3 with you).
  4. GitHub/GitLab: install and log in to gh / glab, then check: node .linx/forge.mjs info
     No CI yet? Re-run with --ci to generate one.
  5. Commit on a branch (e.g. chore/linx-setup). Then in your agent: "use linx-start".`;

function run(argv) {
    const opts = parseArgs(argv);
    const command = opts._[0];
    if (!command || opts.help || command === 'help') return console.log(HELP), 0;
    if (opts.version || command === 'version') return console.log(VERSION), 0;
    const dir = resolve(opts.dir ?? '.');

    if (command === 'check') {
        const r = check(dir);
        if (r.ok) console.log(`linx check: PASS (${r.files} managed files)`);
        else console.error(`linx check: FAIL\n  ${r.problems.join('\n  ')}\nRestore with: linx update --force`);
        return r.ok ? 0 : 1;
    }
    if (command !== 'init' && command !== 'update') {
        console.error(`Unknown command "${command}".\n\n${HELP}`);
        return 1;
    }
    if (command === 'update' && !existsSync(join(dir, LOCK))) {
        console.error(`No ${LOCK} in ${dir} — run "linx init" first.`);
        return 1;
    }
    const tools = opts.tools === 'all' ? TOOLS : typeof opts.tools === 'string' ? opts.tools.split(',') : undefined;
    const plugin = opts.plugin ? true : opts['no-plugin'] ? false : undefined;
    const result = plan(dir, { ...opts, tools, plugin, force: Boolean(opts.force), ci: Boolean(opts.ci) });
    console.log(`linx ${VERSION} ${command}${opts['dry-run'] ? ' (dry run)' : ''} → ${dir}`);
    console.log(`tools: ${result.lock.tools.join(', ')}${result.lock.plugin ? ' (Claude via plugin)' : ''}`);
    console.log(summarize(result.actions));
    if (result.actions.some((a) => a.action === 'conflict'))
        console.log('Conflicts were left untouched. Re-run with --force to overwrite them.');
    if (opts['dry-run']) return 0;
    apply(dir, result);
    if (command === 'init') console.log(NEXT);
    return 0;
}

try {
    process.exitCode = run(process.argv.slice(2));
} catch (e) {
    console.error(`linx: ${e.message}`);
    process.exitCode = 1;
}
