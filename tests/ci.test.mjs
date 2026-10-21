import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ciActions, githubWorkflow, gitlabJob, templateActions } from '../lib/ci.mjs';
import { detectInstall, detectNodeVersion } from '../lib/detect.mjs';
import { apply, plan } from '../lib/install.mjs';
import { tempProject } from './helpers.mjs';

test('node version: .nvmrc, then Dockerfile, then engines, then 20', () => {
    const a = tempProject({ '.nvmrc': 'v22.16.0\n', Dockerfile: 'FROM node:20-alpine' });
    const b = tempProject({ Dockerfile: 'FROM --platform=linux/amd64 node:22.16-alpine AS build' });
    const c = tempProject({ 'package.json': { engines: { node: '>=18' } } });
    const d = tempProject();
    try {
        assert.equal(detectNodeVersion(a.dir), '22.16.0');
        assert.equal(detectNodeVersion(b.dir), '22.16');
        assert.equal(detectNodeVersion(c.dir), '18');
        assert.equal(detectNodeVersion(d.dir), '20');
    } finally {
        [a, b, c, d].forEach((p) => p.cleanup());
    }
});

test('install command per package manager', () => {
    const yarn = tempProject({ 'package.json': {}, 'yarn.lock': '' });
    const berry = tempProject({ 'package.json': {}, 'yarn.lock': '', '.yarnrc.yml': '' });
    const npm = tempProject({ 'package.json': {}, 'package-lock.json': '{}' });
    try {
        assert.equal(detectInstall(yarn.dir).install, 'yarn install --frozen-lockfile');
        assert.equal(detectInstall(berry.dir).install, 'yarn install --immutable');
        assert.equal(detectInstall(npm.dir).install, 'npm ci');
    } finally {
        [yarn, berry, npm].forEach((p) => p.cleanup());
    }
});

test('github workflow runs verify + check on the detected toolchain', () => {
    const { dir, cleanup } = tempProject({ 'package.json': {}, 'pnpm-lock.yaml': '', '.nvmrc': '22' });
    try {
        const yml = githubWorkflow(dir, { baseBranch: 'develop' }, '9.9.9');
        assert.match(yml, /branches: \[develop\]/);
        assert.match(yml, /pnpm\/action-setup@v4\n {8}with:\n {10}version: 9/);
        assert.match(yml, /node-version: '22'/);
        assert.match(yml, /cache: pnpm/);
        assert.match(yml, /run: pnpm install --frozen-lockfile/);
        assert.match(yml, /run: node \.linx\/verify\.mjs/);
        assert.match(yml, /npx -y github:hublinx\/linx#v9\.9\.9 check/);
        assert.ok(!yml.includes('\t'));
    } finally {
        cleanup();
    }
});

test('gitlab job uses a full node image and the lockfile cache', () => {
    const { dir, cleanup } = tempProject({ 'package.json': {}, 'yarn.lock': '', Dockerfile: 'FROM node:20-alpine' });
    try {
        const yml = gitlabJob(dir, { baseBranch: 'main' }, '1.0.0');
        assert.match(yml, /image: node:20\n/);
        assert.match(yml, /files: \[yarn\.lock\]/);
        assert.match(yml, /\$CI_PIPELINE_SOURCE == "merge_request_event"/);
        assert.match(yml, /- yarn install --frozen-lockfile/);
    } finally {
        cleanup();
    }
});

test('gitlab: include is added only when safe', () => {
    const cases = [
        [null, 'create'],
        ['build:\n  script: [make]\n', 'merge'],
        ['include:\n  - template: x.yml\n', 'manual'],
        ['stages:\n  - build\n  - deploy\n', 'manual'],
        ['stages:\n  - build\n  - test\n', 'merge'],
        ['include:\n  - local: .gitlab/ci/linx.yml\n', null],
    ];
    for (const [main, expected] of cases) {
        const p = tempProject(main === null ? {} : { '.gitlab-ci.yml': main });
        try {
            const a = ciActions(p.dir, { forge: 'gitlab' }, '1.0.0').find((x) => x.rel === '.gitlab-ci.yml');
            assert.equal(a?.action ?? null, expected, String(main));
            if (expected === 'merge') assert.match(a.content, /include:\n {2}- local: \.gitlab\/ci\/linx\.yml\n$/);
        } finally {
            p.cleanup();
        }
    }
});

test('existing CI and PR templates are never overwritten', () => {
    const { dir, cleanup } = tempProject({
        '.github/workflows/linx.yml': 'mine',
        '.github/PULL_REQUEST_TEMPLATE.md': 'mine',
    });
    try {
        assert.deepEqual(ciActions(dir, { forge: 'github' }, '1'), []);
        assert.deepEqual(templateActions(dir, { forge: 'github' }, 'x'), []);
        assert.equal(templateActions(dir, { forge: 'gitlab' }, 'x')[0].rel, '.gitlab/merge_request_templates/Default.md');
        assert.deepEqual(templateActions(dir, { forge: 'none' }, 'x'), []);
    } finally {
        cleanup();
    }
});

test('init --ci on a GitHub project writes workflow, PR template and forge bridge', () => {
    const { dir, cleanup } = tempProject({ 'package.json': { scripts: { test: 'node --test' } } }, { git: true });
    try {
        apply(dir, plan(dir, { tools: ['claude'], forge: 'github', ci: true }));
        assert.match(readFileSync(join(dir, '.github/workflows/linx.yml'), 'utf8'), /node \.linx\/verify\.mjs/);
        assert.match(readFileSync(join(dir, '.github/pull_request_template.md'), 'utf8'), /## Verify/);
        assert.match(readFileSync(join(dir, '.linx/forge.mjs'), 'utf8'), /linx forge bridge/);
        // Re-running changes nothing: CI and template are project-owned.
        const again = plan(dir, { ci: true }).actions.filter((a) => a.action !== 'unchanged');
        assert.deepEqual(again, []);
    } finally {
        cleanup();
    }
});

test('.NET CI: setup-dotnet on GitHub, SDK image + Node on GitLab', () => {
    const withGlobal = tempProject({ 'App.sln': '', 'global.json': { sdk: { version: '8.0.400' } }, 'src/App/App.csproj': '' });
    const plain = tempProject({ 'App.csproj': '<TargetFramework>net9.0</TargetFramework>' });
    try {
        const gh = githubWorkflow(withGlobal.dir, { baseBranch: 'main' }, '1.0.0');
        assert.match(gh, /actions\/setup-dotnet@v4\n {8}with:\n {10}global-json-file: global\.json\n {6}- run: dotnet restore App\.sln/);
        assert.ok(!gh.includes('setup-node'));
        assert.match(githubWorkflow(plain.dir, {}, '1.0.0'), /dotnet-version: '9\.0\.x'/);
        const gl = gitlabJob(withGlobal.dir, { baseBranch: 'main' }, '1.0.0');
        assert.match(gl, /image: mcr\.microsoft\.com\/dotnet\/sdk:8\.0\n/);
        assert.match(gl, /apt-get install -y -qq nodejs npm/);
        assert.match(gl, /- dotnet restore App\.sln\n {4}- node \.linx\/verify\.mjs/);
        assert.match(gl, /NUGET_PACKAGES/);
    } finally {
        withGlobal.cleanup();
        plain.cleanup();
    }
});
