#!/usr/bin/env node
// linx SessionStart hook: reminds the agent of the workflow and lists unfinished work items.
// Silent in projects without .linx/config.json, so a user-level plugin install never nags.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_WORK = 'docs/linx/work';
const OPEN = new Set(['doing', 'blocked']);

export function readConfig(root) {
    const file = join(root, '.linx', 'config.json');
    if (!existsSync(file)) return null;
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return {};
    }
}

export function frontmatter(text) {
    const body = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    const out = {};
    for (const line of body.split('\n')) {
        const i = line.indexOf(':');
        if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return out;
}

export function openWork(workDir) {
    if (!existsSync(workDir)) return [];
    return readdirSync(workDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(workDir, e.name, 'progress.md')))
        .map((e) => ({ ...frontmatter(readFileSync(join(workDir, e.name, 'progress.md'), 'utf8')), slug: e.name }))
        .filter((w) => OPEN.has(w.status))
        .sort((a, b) => b.slug.localeCompare(a.slug));
}

export function render(config, work) {
    const base = config.baseBranch ?? 'main';
    const lines = [
        '# linx SDLC',
        '',
        'This project follows linx. Start every task — feature, bug, small change or code question — with the `linx-start` skill.',
        '- Project rules: AGENTS.md. Workflow config: .linx/config.json.',
        `- Work state: ${config.paths?.work ?? DEFAULT_WORK}/<slug>/{spec,plan,progress}.md — update, commit and push after every task.`,
        '- Never claim "done" before `node .linx/verify.mjs` passes; record its `verify:` line.',
        `- Branch from origin/${base} and open a PR/MR into ${base}; never push to ${base} directly.`,
    ];
    if (work.length) {
        lines.push('', 'Unfinished work (continue with `linx-resume <slug>`):');
        for (const w of work.slice(0, 5)) {
            const owner = w.owner ? `, owner ${w.owner}` : '';
            const updated = w.updated ? `, updated ${w.updated}` : '';
            lines.push(`- ${w.slug} — ${w.status}${owner}${updated}`);
        }
    }
    return lines.join('\n') + '\n';
}

// Inside the Claude Code plugin this runs from the plugin folder. If the project also has the local copy
// (installed with `linx init` without --plugin), let that one speak so the reminder is not printed twice.
export function isShadowed(root, self, name) {
    const rel = relative(root, self);
    const insideProject = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    return !insideProject && existsSync(join(root, '.linx', 'hooks', name));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
    if (isShadowed(root, fileURLToPath(import.meta.url), 'session-start.mjs')) process.exit(0);
    const config = readConfig(root);
    if (!config) process.exit(0);
    process.stdout.write(render(config, openWork(resolve(root, config.paths?.work ?? DEFAULT_WORK))));
}
