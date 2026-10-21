import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PKG_ROOT, apply, check, ensureImport, mergeClaudeSettings, plan, upsertBlock } from '../lib/install.mjs';
import { tempProject } from './helpers.mjs';

const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');
const install = (dir, opts) => {
    const p = plan(dir, opts);
    apply(dir, p);
    return p;
};
const byAction = (p, action) => p.actions.filter((a) => a.action === action).map((a) => a.rel);

test('init writes config, verify gate, skills, agents, hooks and merged files', () => {
    const { dir, cleanup } = tempProject({ 'package.json': { scripts: { test: 'node --test' } } }, { git: true });
    try {
        install(dir, { tools: ['claude', 'cursor'] });
        for (const rel of [
            '.linx/config.json',
            '.linx/verify.mjs',
            '.linx/lock.json',
            '.linx/hooks/session-start.mjs',
            '.claude/skills/linx-start/SKILL.md',
            '.claude/skills/linx-execute/progress-template.md',
            '.claude/agents/linx-reviewer.md',
            '.cursor/skills/linx-start/SKILL.md',
            '.cursor/rules/linx.mdc',
            'docs/linx/knowledge/INDEX.md',
            'docs/linx/work/.gitkeep',
        ])
            assert.ok(existsSync(join(dir, rel)), rel);
        const config = JSON.parse(read(dir, '.linx/config.json'));
        assert.equal(config.baseBranch, 'main');
        assert.deepEqual(config.verify, [{ name: 'test', cmd: 'npm run test' }]);
        assert.match(read(dir, 'AGENTS.md'), /linx:begin[\s\S]*origin\/main[\s\S]*linx:end/);
        assert.equal(read(dir, 'CLAUDE.md'), '@AGENTS.md\n');
        const settings = JSON.parse(read(dir, '.claude/settings.json'));
        assert.equal(settings.hooks.SessionStart.length, 1);
        assert.ok(settings.permissions.allow.includes('Bash(node .linx/verify.mjs:*)'));
        assert.ok(check(dir).ok);
    } finally {
        cleanup();
    }
});

test('re-running is idempotent and never overwrites the config', () => {
    const { dir, cleanup } = tempProject({}, { git: true });
    try {
        install(dir, { tools: ['claude'] });
        const config = JSON.parse(read(dir, '.linx/config.json'));
        config.baseBranch = 'develop';
        writeFileSync(join(dir, '.linx/config.json'), JSON.stringify(config));
        install(dir, {});
        const again = plan(dir, {});
        assert.deepEqual(
            again.actions.filter((a) => a.action !== 'unchanged'),
            [],
            'second update changes nothing',
        );
        assert.equal(JSON.parse(read(dir, '.linx/config.json')).baseBranch, 'develop');
        assert.match(read(dir, 'AGENTS.md'), /origin\/develop/);
        assert.equal(read(dir, 'AGENTS.md').match(/linx:begin/g).length, 1);
    } finally {
        cleanup();
    }
});

test('hand-edited managed files are conflicts: kept by update, flagged by check, replaced by --force', () => {
    const { dir, cleanup } = tempProject({}, { git: true });
    try {
        install(dir, { tools: ['claude'] });
        const rel = '.claude/skills/linx-start/SKILL.md';
        writeFileSync(join(dir, rel), 'my edit');
        const p = install(dir, {});
        assert.deepEqual(byAction(p, 'conflict'), [rel]);
        assert.equal(read(dir, rel), 'my edit');
        assert.deepEqual(check(dir).problems, [`edited by hand: ${rel}`]);
        install(dir, { force: true });
        assert.equal(read(dir, rel), read(PKG_ROOT, 'skills/linx-start/SKILL.md'));
        assert.ok(check(dir).ok);
    } finally {
        cleanup();
    }
});

test('--plugin skips Claude copies, removes the old ones and their hooks', () => {
    const { dir, cleanup } = tempProject({}, { git: true });
    try {
        install(dir, { tools: ['claude'] });
        assert.ok(existsSync(join(dir, '.claude/skills/linx-start/SKILL.md')));
        const p = install(dir, { plugin: true });
        assert.ok(byAction(p, 'remove').includes('.claude/skills/linx-start/SKILL.md'));
        assert.ok(!existsSync(join(dir, '.claude/skills/linx-start/SKILL.md')));
        assert.ok(!existsSync(join(dir, '.linx/hooks/session-start.mjs')));
        assert.ok(existsSync(join(dir, '.linx/verify.mjs')));
        const settings = JSON.parse(read(dir, '.claude/settings.json'));
        assert.equal(settings.hooks, undefined);
        assert.ok(settings.permissions.allow.includes('Bash(node .linx/verify.mjs:*)'));
    } finally {
        cleanup();
    }
});

test('existing AGENTS.md, CLAUDE.md and settings are preserved', () => {
    const { dir, cleanup } = tempProject(
        {
            'AGENTS.md': '# My project\n\nOwn rules.\n',
            'CLAUDE.md': '# Claude notes\n',
            '.claude/settings.json': { permissions: { allow: ['Bash(ls:*)'] }, model: 'opus' },
        },
        { git: true },
    );
    try {
        install(dir, { tools: ['claude'] });
        assert.match(read(dir, 'AGENTS.md'), /^# My project\n\nOwn rules\.\n\n<!-- linx:begin/);
        assert.equal(read(dir, 'CLAUDE.md'), '# Claude notes\n\n@AGENTS.md\n');
        const s = JSON.parse(read(dir, '.claude/settings.json'));
        assert.equal(s.model, 'opus');
        assert.deepEqual(s.permissions.allow, ['Bash(ls:*)', 'Bash(node .linx/verify.mjs:*)']);
    } finally {
        cleanup();
    }
});

test('external work/knowledge folders are not created inside the repo', () => {
    const { dir, cleanup } = tempProject({}, { git: true });
    try {
        const p = install(dir, { tools: ['claude'], work: '../shared/work', knowledge: '../shared/knowledge' });
        assert.ok(!p.actions.some((a) => a.rel.includes('shared')));
    } finally {
        cleanup();
    }
});

test('block, import and settings helpers', () => {
    const block = '<!-- linx:begin x -->\nnew\n<!-- linx:end -->\n';
    assert.equal(upsertBlock('a\n<!-- linx:begin y -->\nold\n<!-- linx:end -->\nb\n', block), `a\n${block}b\n`);
    assert.equal(ensureImport('x\n@AGENTS.md\n'), 'x\n@AGENTS.md\n');
    const twice = mergeClaudeSettings(mergeClaudeSettings({}, { hooks: true }), { hooks: true });
    assert.equal(twice.hooks.PostToolUse.length, 1);
});

test('CLI: init --dry-run writes nothing; check fails before init', () => {
    const { dir, cleanup } = tempProject({}, { git: true });
    const cli = join(PKG_ROOT, 'bin', 'cli.mjs');
    try {
        const dry = spawnSync(process.execPath, [cli, 'init', `--dir=${dir}`, '--dry-run'], { encoding: 'utf8' });
        assert.equal(dry.status, 0, dry.stderr);
        assert.match(dry.stdout, /dry run/);
        assert.ok(!existsSync(join(dir, '.linx')));
        const c = spawnSync(process.execPath, [cli, 'check', `--dir=${dir}`], { encoding: 'utf8' });
        assert.equal(c.status, 1);
        const init = spawnSync(process.execPath, [cli, 'init', `--dir=${dir}`, '--tools=all'], { encoding: 'utf8' });
        assert.equal(init.status, 0, init.stderr);
        assert.ok(existsSync(join(dir, '.agents/skills/linx-start/SKILL.md')));
        const ok = spawnSync(process.execPath, [cli, 'check', `--dir=${dir}`], { encoding: 'utf8' });
        assert.equal(ok.status, 0, ok.stderr);
    } finally {
        cleanup();
    }
});
