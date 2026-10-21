// Package integrity: skill/agent frontmatter, cross-references, manifest versions.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PKG_ROOT } from '../lib/install.mjs';

const read = (...p) => readFileSync(join(PKG_ROOT, ...p), 'utf8');
const frontmatter = (text) => {
    const body = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    return Object.fromEntries(
        body.split('\n').map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]),
    );
};
const skills = readdirSync(join(PKG_ROOT, 'skills'));

test('every skill has valid frontmatter and stays short', () => {
    assert.ok(skills.length >= 10);
    for (const name of skills) {
        const text = read('skills', name, 'SKILL.md');
        const fm = frontmatter(text);
        assert.equal(fm.name, name, `${name}: frontmatter name`);
        assert.match(fm.description, /^Use /, `${name}: description should start with "Use"`);
        assert.ok(fm.description.length <= 1024, `${name}: description too long`);
        assert.ok(text.split('\n').length <= 80, `${name}: SKILL.md over 80 lines`);
    }
});

test('skill cross-references point at existing files and skills', () => {
    for (const name of skills) {
        const text = read('skills', name, 'SKILL.md');
        for (const [, skill, file] of text.matchAll(/\.\.\/(linx-[\w-]+)\/([\w.-]+\.md)/g))
            assert.ok(existsSync(join(PKG_ROOT, 'skills', skill, file)), `${name} → ../${skill}/${file}`);
        for (const [, file] of text.matchAll(/`([\w-]+\.md)` \(this folder\)/g))
            assert.ok(existsSync(join(PKG_ROOT, 'skills', name, file)), `${name} → ${file}`);
        // Skip branch names such as `chore/linx-setup`.
        for (const [ref] of text.matchAll(/(?<![\w/])linx-[a-z]+\b/g))
            assert.ok(
                skills.includes(ref) || existsSync(join(PKG_ROOT, 'agents', `${ref}.md`)),
                `${name} mentions unknown ${ref}`,
            );
    }
});

test('agents have name, description and model', () => {
    for (const file of readdirSync(join(PKG_ROOT, 'agents'))) {
        const fm = frontmatter(read('agents', file));
        assert.equal(`${fm.name}.md`, file);
        assert.ok(fm.description && fm.model, `${file}: description/model`);
    }
});

test('package, plugin and marketplace versions match', () => {
    const pkg = JSON.parse(read('package.json'));
    const plugin = JSON.parse(read('.claude-plugin', 'plugin.json'));
    const market = JSON.parse(read('.claude-plugin', 'marketplace.json'));
    assert.equal(plugin.version, pkg.version);
    assert.equal(market.plugins[0].version, pkg.version);
    assert.equal(market.plugins[0].name, plugin.name);
});

test('plugin hooks reference existing scripts', () => {
    const hooks = JSON.parse(read('hooks', 'hooks.json')).hooks;
    for (const entries of Object.values(hooks))
        for (const e of entries)
            for (const h of e.hooks) {
                const script = h.command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/)[1];
                assert.ok(existsSync(join(PKG_ROOT, script)), script);
            }
});
