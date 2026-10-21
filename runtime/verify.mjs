#!/usr/bin/env node
// linx verify gate — managed by linx, do not edit. Configure steps in .linx/config.json → "verify".
// Runs each step and prints only failures plus one summary line, e.g. `verify: PASS 4/4 in 83s`.
// Steps with "baseline" fail only on NEW errors compared with .linx/baseline/<step>.json.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const posix = (p) => p.split('\\').join('/');
const tail = (s, n = 40) => s.trim().split(/\r?\n/).slice(-n).join('\n');

function jsonArray(out) {
    const start = out.indexOf('[');
    if (start < 0) return null;
    try {
        return JSON.parse(out.slice(start));
    } catch {
        return null;
    }
}

// Each parser returns { "<file>": errorCount } or null when the output cannot be read.
export const parsers = {
    tsc(out, cwd) {
        const counts = {};
        for (const line of out.split(/\r?\n/)) {
            const m = line.match(/^(.+?)\(\d+,\d+\): error TS\d+/);
            if (!m) {
                // Errors without a file (tsconfig, missing @types, ...) still count — group them as <global>.
                if (/(^|\s)error TS\d+:/.test(line)) counts['<global>'] = (counts['<global>'] ?? 0) + 1;
                continue;
            }
            const file = posix(relative(cwd, resolve(cwd, m[1].trim())));
            counts[file] = (counts[file] ?? 0) + 1;
        }
        return counts;
    },
    'eslint-json'(out, cwd) {
        const data = jsonArray(out);
        if (!data) return null;
        const counts = {};
        for (const r of data) if (r.errorCount > 0) counts[posix(relative(cwd, r.filePath))] = r.errorCount;
        return counts;
    },
    'ruff-json'(out, cwd) {
        const data = jsonArray(out);
        if (!data) return null;
        const counts = {};
        for (const d of data) {
            const file = posix(relative(cwd, resolve(cwd, d.filename)));
            counts[file] = (counts[file] ?? 0) + 1;
        }
        return counts;
    },
};

export function regressions(counts, baseline) {
    return Object.entries(counts)
        .filter(([file, n]) => n > (baseline[file] ?? 0))
        .map(([file, n]) => `${file}: ${baseline[file] ?? 0} → ${n}`);
}

export function runStep(step, cwd, { updateBaseline = false, run = spawnSync } = {}) {
    const t0 = Date.now();
    const r = run(step.cmd, { cwd, shell: true, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
    const all = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    const secs = Math.round((Date.now() - t0) / 1000);
    if (r.signal || r.error) {
        return { ok: false, secs, detail: `Process stopped (${r.signal ?? r.error?.message})\n${tail(all)}` };
    }
    if (!step.baseline) return { ok: r.status === 0, secs, detail: r.status === 0 ? '' : tail(all) };

    const parser = parsers[step.baseline];
    if (!parser) return { ok: false, secs, detail: `Unknown baseline parser "${step.baseline}"` };
    let counts = parser(r.stdout ?? '', cwd);
    if (counts && Object.keys(counts).length === 0 && r.status !== 0) counts = null;
    if (!counts) return { ok: false, secs, detail: `Could not read ${step.baseline} output (tool crashed?)\n${tail(all)}` };

    const dir = join(cwd, '.linx', 'baseline');
    const file = join(dir, `${step.name}.json`);
    if (updateBaseline) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, JSON.stringify(counts, null, 2) + '\n');
        return { ok: true, secs, detail: `baseline ${step.name}: ${Object.keys(counts).length} files with errors` };
    }
    const baseline = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    const reg = regressions(counts, baseline);
    return { ok: reg.length === 0, secs, detail: reg.length ? `New errors vs baseline:\n${reg.join('\n')}` : '' };
}

const listArg = (args, flag) =>
    args
        .find((a) => a.startsWith(`--${flag}=`))
        ?.slice(flag.length + 3)
        .split(',');

// --only=a,b runs just these (including "default": false steps such as e2e); --skip=a,b leaves these out.
export function selectSteps(steps, args) {
    const only = listArg(args, 'only');
    const skip = listArg(args, 'skip') ?? [];
    return steps.filter((s) => (only ? only.includes(s.name) : s.default !== false) && !skip.includes(s.name));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const args = process.argv.slice(2);
    const updateBaseline = args.includes('--update-baseline');
    const cwd = process.cwd();
    const configFile = join(cwd, '.linx', 'config.json');
    const steps = existsSync(configFile) ? (JSON.parse(readFileSync(configFile, 'utf8')).verify ?? []) : [];
    if (!steps.length) {
        console.log('verify: FAIL — no steps configured. Add them to "verify" in .linx/config.json.');
        process.exit(1);
    }
    const t0 = Date.now();
    const failed = [];
    let ran = 0;
    for (const step of selectSteps(steps, args)) {
        if (updateBaseline && !step.baseline) continue;
        const r = runStep(step, cwd, { updateBaseline });
        ran++;
        console.log(`${r.ok ? '✔' : '✘'} ${step.name} (${r.secs}s)`);
        if (r.detail) console.log(r.detail);
        if (!r.ok) failed.push(step.name);
    }
    const total = Math.round((Date.now() - t0) / 1000);
    const status = failed.length || ran === 0 ? 'FAIL' : 'PASS';
    const note = failed.length ? ` (failed: ${failed.join(', ')})` : ran === 0 ? ' (no step selected)' : '';
    console.log(`verify: ${status} ${ran - failed.length}/${ran}${note} in ${total}s`);
    process.exit(status === 'PASS' ? 0 : 1);
}
