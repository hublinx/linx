// Plan and apply a linx install in a target project.
// Three kinds of files:
// - managed: copied from this package and tracked in .linx/lock.json (skills, agents, hooks, verify gate, rule);
// - project-owned: created once, never overwritten (.linx/config.json, knowledge INDEX.md, work folder);
// - merged: AGENTS.md (managed block between markers), CLAUDE.md (@AGENTS.md import), .claude/settings.json.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ciActions, templateActions } from './ci.mjs';
import { detectBaseBranch, detectForge, detectFormat, detectTools, detectVerify } from './detect.mjs';

export const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(p, 'utf8');
const readOrNull = (p) => (existsSync(p) ? read(p) : null);
const posix = (p) => p.split('\\').join('/');
const tpl = (name) => read(join(PKG_ROOT, 'templates', name));

export const VERSION = JSON.parse(read(join(PKG_ROOT, 'package.json'))).version;
export const LOCK = '.linx/lock.json';
export const CONFIG = '.linx/config.json';
export const TOOLS = ['claude', 'cursor', 'agents'];
const SKILL_DIRS = { claude: '.claude/skills', cursor: '.cursor/skills', agents: '.agents/skills' };
const HOOKS = ['session-start.mjs', 'post-edit.mjs'];
const BEGIN = '<!-- linx:begin';
const END = '<!-- linx:end -->';

export const DEFAULT_PATHS = { work: 'docs/linx/work', knowledge: 'docs/linx/knowledge' };
export const DEFAULT_ESCALATION = [
    'database schema changes, migrations, or index changes',
    'authentication, authorization, or permission logic',
    'money: pricing, payments, invoices, balances, payroll, commissions',
    'public or cross-service API contracts',
    'changes spanning more than one repository',
];
export const DEFAULT_SENSITIVE = ['(^|/)\\.env($|\\.)', '\\.(pem|key|p12|pfx)$', '(^|/)(secrets?|credentials?)(/|\\.|$)'];

export const normalize = (s) => s.replace(/\r\n/g, '\n');
export const hash = (s) => createHash('sha256').update(normalize(s)).digest('hex');

export function walk(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );
}

export function managedFiles({ tools, plugin }) {
    const out = {};
    const copy = (src, dest) => {
        for (const file of walk(src)) out[`${dest}/${posix(relative(src, file))}`] = read(file);
    };
    out['.linx/verify.mjs'] = read(join(PKG_ROOT, 'runtime', 'verify.mjs'));
    out['.linx/forge.mjs'] = read(join(PKG_ROOT, 'runtime', 'forge.mjs'));
    for (const tool of tools) {
        // The Claude Code plugin already ships skills, agents and hooks.
        if (tool === 'claude' && plugin) continue;
        copy(join(PKG_ROOT, 'skills'), SKILL_DIRS[tool]);
    }
    if (tools.includes('claude') && !plugin) {
        copy(join(PKG_ROOT, 'agents'), '.claude/agents');
        for (const name of HOOKS) out[`.linx/hooks/${name}`] = read(join(PKG_ROOT, 'hooks', name));
    }
    if (tools.includes('cursor')) out['.cursor/rules/linx.mdc'] = tpl('cursor-rule.mdc');
    return out;
}

export function defaultConfig(dir, opts = {}) {
    return {
        $schema: 'https://raw.githubusercontent.com/hublinx/linx/main/schema/config.schema.json',
        baseBranch: opts.base ?? detectBaseBranch(dir),
        forge: opts.forge ?? detectForge(dir),
        docsLanguage: 'English',
        paths: { work: opts.work ?? DEFAULT_PATHS.work, knowledge: opts.knowledge ?? DEFAULT_PATHS.knowledge },
        smallTaskMaxFiles: 5,
        escalation: DEFAULT_ESCALATION,
        verify: detectVerify(dir),
        review: { checklist: [] },
        sensitivePaths: DEFAULT_SENSITIVE,
        format: detectFormat(dir),
    };
}

export function renderBlock(config) {
    return tpl('agents-block.md')
        .replaceAll('{{work}}', config.paths?.work ?? DEFAULT_PATHS.work)
        .replaceAll('{{knowledge}}', config.paths?.knowledge ?? DEFAULT_PATHS.knowledge)
        .replaceAll('{{baseBranch}}', config.baseBranch ?? 'main')
        .replaceAll('{{escalation}}', (config.escalation ?? DEFAULT_ESCALATION).join('; '));
}

export function upsertBlock(text, block) {
    const start = text.indexOf(BEGIN);
    const end = text.indexOf(END);
    if (start >= 0 && end > start) return text.slice(0, start) + block.trimEnd() + text.slice(end + END.length);
    return `${text.trimEnd()}\n\n${block}`;
}

export function ensureImport(text) {
    if (text === null) return '@AGENTS.md\n';
    if (/^@AGENTS\.md\s*$/m.test(text)) return text;
    return `${text.trimEnd()}\n\n@AGENTS.md\n`;
}

const isLinxHook = (entry) => entry.hooks?.some((h) => String(h.command).includes('.linx/hooks/'));

export function mergeClaudeSettings(settings, { hooks }) {
    const s = structuredClone(settings ?? {});
    s.permissions ??= {};
    const add = (key, items) => {
        s.permissions[key] = [...new Set([...(s.permissions[key] ?? []), ...items])];
    };
    add('allow', ['Bash(node .linx/verify.mjs:*)']);
    add('deny', ['Read(./.env)', 'Read(./.env.*)']);
    const ours = {
        SessionStart: { hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.linx/hooks/session-start.mjs"' }] },
        PostToolUse: {
            matcher: 'Edit|Write|MultiEdit',
            hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.linx/hooks/post-edit.mjs"' }],
        },
    };
    for (const [event, entry] of Object.entries(ours)) {
        const list = (s.hooks?.[event] ?? []).filter((e) => !isLinxHook(e));
        if (hooks) list.push(entry);
        if (list.length) (s.hooks ??= {})[event] = list;
        else if (s.hooks) delete s.hooks[event];
    }
    if (s.hooks && !Object.keys(s.hooks).length) delete s.hooks;
    return s;
}

const insideRepo = (dir, p) => {
    const rel = relative(dir, resolve(dir, p));
    return !rel.startsWith('..') && !isAbsolute(rel);
};
const json = (v, indent = 4) => JSON.stringify(v, null, indent) + '\n';

/**
 * Compute every change without writing. opts: { tools?, plugin?, force?, ci?, base?, forge?, work?, knowledge? }.
 * Actions: create | update | merge | remove | unchanged | conflict (managed file edited by hand or not ours)
 * | manual (could not edit safely; `note` says what to do by hand).
 */
export function plan(dir, opts = {}) {
    const lock = JSON.parse(readOrNull(join(dir, LOCK)) ?? 'null');
    const tools = opts.tools ?? lock?.tools ?? detectTools(dir);
    const plugin = opts.plugin ?? lock?.plugin ?? false;
    const bad = tools.filter((t) => !TOOLS.includes(t));
    if (bad.length) throw new Error(`Unknown tool(s): ${bad.join(', ')} (use ${TOOLS.join(', ')})`);

    const actions = [];
    const nextLock = { version: 1, linx: VERSION, tools, plugin, files: {} };
    const managed = managedFiles({ tools, plugin });
    for (const [rel, content] of Object.entries(managed)) {
        const current = readOrNull(join(dir, rel));
        const known = lock?.files?.[rel];
        let action;
        if (current === null) action = 'create';
        else if (hash(current) === hash(content)) action = 'unchanged';
        else if (opts.force || (known && hash(current) === known)) action = 'update';
        else action = 'conflict';
        actions.push({ rel, action, content });
        // A conflicting file keeps its old lock hash (so `check` keeps flagging it); a file we never owned stays out.
        if (action !== 'conflict') nextLock.files[rel] = hash(content);
        else if (known) nextLock.files[rel] = known;
    }
    for (const [rel, known] of Object.entries(lock?.files ?? {})) {
        if (rel in managed) continue;
        const current = readOrNull(join(dir, rel));
        if (current === null) continue;
        if (opts.force || hash(current) === known) actions.push({ rel, action: 'remove' });
        else actions.push({ rel, action: 'conflict', note: 'no longer managed, edited by hand — left in place' });
    }

    const configText = readOrNull(join(dir, CONFIG));
    let config;
    if (configText === null) {
        config = defaultConfig(dir, opts);
        actions.push({ rel: CONFIG, action: 'create', content: json(config) });
    } else {
        try {
            config = JSON.parse(configText);
        } catch (e) {
            throw new Error(`${CONFIG} is not valid JSON: ${e.message}`);
        }
    }
    const knowledge = config.paths?.knowledge ?? DEFAULT_PATHS.knowledge;
    const work = config.paths?.work ?? DEFAULT_PATHS.work;
    if (insideRepo(dir, knowledge) && !existsSync(join(dir, knowledge, 'INDEX.md')))
        actions.push({ rel: posix(join(knowledge, 'INDEX.md')), action: 'create', content: tpl('knowledge-index.md') });
    if (insideRepo(dir, work) && !existsSync(join(dir, work)))
        actions.push({ rel: posix(join(work, '.gitkeep')), action: 'create', content: '' });
    actions.push(...templateActions(dir, config, tpl('pr-template.md')));
    if (opts.ci) actions.push(...ciActions(dir, config, VERSION));

    const agents = readOrNull(join(dir, 'AGENTS.md'));
    const header = tpl('agents-header.md').replaceAll('{{project}}', basename(resolve(dir)));
    const nextAgents = upsertBlock(agents ?? header, renderBlock(config));
    if (nextAgents !== agents)
        actions.push({ rel: 'AGENTS.md', action: agents === null ? 'create' : 'merge', content: nextAgents });

    if (tools.includes('claude')) {
        const claude = readOrNull(join(dir, 'CLAUDE.md'));
        const nextClaude = ensureImport(claude);
        if (nextClaude !== claude)
            actions.push({ rel: 'CLAUDE.md', action: claude === null ? 'create' : 'merge', content: nextClaude });

        const settingsRel = '.claude/settings.json';
        const settingsText = readOrNull(join(dir, settingsRel));
        let settings = {};
        if (settingsText !== null) {
            try {
                settings = JSON.parse(settingsText);
            } catch (e) {
                throw new Error(`${settingsRel} is not valid JSON: ${e.message}`);
            }
        }
        const merged = mergeClaudeSettings(settings, { hooks: !plugin });
        if (JSON.stringify(merged) !== JSON.stringify(settings))
            actions.push({ rel: settingsRel, action: settingsText === null ? 'create' : 'merge', content: json(merged, 2) });
    }
    return { actions, lock: nextLock, config };
}

export function apply(dir, { actions, lock }) {
    for (const a of actions) {
        const file = join(dir, a.rel);
        if (a.action === 'remove') rmSync(file, { force: true });
        if (!['create', 'update', 'merge'].includes(a.action)) continue;
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, a.content);
    }
    mkdirSync(join(dir, '.linx'), { recursive: true });
    writeFileSync(join(dir, LOCK), json(lock, 2));
}

/** Managed files that are missing or were edited by hand since the last install/update. */
export function check(dir) {
    const lockText = readOrNull(join(dir, LOCK));
    if (lockText === null) return { ok: false, problems: [`missing ${LOCK} — run: linx init`] };
    const lock = JSON.parse(lockText);
    const problems = [];
    for (const [rel, known] of Object.entries(lock.files)) {
        const current = readOrNull(join(dir, rel));
        if (current === null) problems.push(`missing: ${rel}`);
        else if (hash(current) !== known) problems.push(`edited by hand: ${rel}`);
    }
    return { ok: problems.length === 0, problems, files: Object.keys(lock.files).length };
}
