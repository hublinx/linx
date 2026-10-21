import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectForge, detectFormat, detectTools, detectVerify, packageManager } from '../lib/detect.mjs';
import { tempProject } from './helpers.mjs';

const names = (steps) => steps.map((s) => s.name);

test('node project: tsc + eslint get baselines, scripts for test/build', () => {
    const { dir, cleanup } = tempProject({
        'package.json': {
            scripts: { test: 'vitest run', build: 'vite build', lint: 'eslint .' },
            devDependencies: { eslint: '9', prettier: '3' },
        },
        'tsconfig.json': '{ "compilerOptions": {} }',
        'pnpm-lock.yaml': '',
    });
    try {
        const steps = detectVerify(dir);
        assert.deepEqual(names(steps), ['typecheck', 'lint', 'test', 'build']);
        assert.equal(steps[0].baseline, 'tsc');
        assert.equal(steps[0].cmd, 'npx tsc --noEmit --pretty false');
        assert.equal(steps[1].baseline, 'eslint-json');
        assert.equal(steps[2].cmd, 'pnpm run test');
        assert.equal(packageManager(dir), 'pnpm');
        assert.match(detectFormat(dir).command, /prettier/);
    } finally {
        cleanup();
    }
});

test('solution-style tsconfig uses tsc -b; npm default test script is ignored', () => {
    const { dir, cleanup } = tempProject({
        'package.json': { scripts: { test: 'echo "Error: no test specified" && exit 1' } },
        'tsconfig.json': '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }',
    });
    try {
        const steps = detectVerify(dir);
        assert.deepEqual(names(steps), ['typecheck']);
        assert.equal(steps[0].cmd, 'npx tsc -b --pretty false');
    } finally {
        cleanup();
    }
});

test('python, go and unknown projects', () => {
    const py = tempProject({ 'pyproject.toml': '[tool.ruff]\n[tool.pytest.ini_options]\n' });
    const go = tempProject({ 'go.mod': 'module x' });
    const none = tempProject({ 'README.md': '' });
    try {
        assert.deepEqual(names(detectVerify(py.dir)), ['lint', 'test']);
        assert.equal(detectVerify(py.dir)[0].baseline, 'ruff-json');
        assert.equal(detectFormat(py.dir).command, 'ruff format {file}');
        assert.deepEqual(names(detectVerify(go.dir)), ['vet', 'test', 'build']);
        assert.deepEqual(detectVerify(none.dir), []);
        assert.equal(detectFormat(none.dir), null);
    } finally {
        py.cleanup();
        go.cleanup();
        none.cleanup();
    }
});

test('tools and forge', () => {
    const { dir, cleanup } = tempProject({ '.cursor/rules/x.mdc': '' }, { git: true });
    try {
        assert.deepEqual(detectTools(dir), ['claude', 'cursor']);
        assert.equal(detectForge(dir), 'none');
    } finally {
        cleanup();
    }
});

test('.NET: solution at the root wins; version from TargetFramework; dotnet format on edit', async () => {
    const { detectDotnet } = await import('../lib/detect.mjs');
    const { dir, cleanup } = tempProject({
        'My App.sln': '',
        'src/Api/Api.csproj': '<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
        'tests/Api.Tests/Api.Tests.csproj': '<TargetFrameworks>net6.0;net9.0</TargetFrameworks>',
        'package.json': { scripts: { build: 'vite build' } },
    });
    try {
        assert.deepEqual(detectDotnet(dir), { target: 'My App.sln', version: '9.0', globalJson: false });
        const steps = detectVerify(dir);
        assert.deepEqual(names(steps), ['build', 'format', 'test']);
        assert.equal(steps[0].cmd, 'dotnet build "My App.sln" --nologo --no-incremental -clp:NoSummary');
        assert.equal(steps[0].baseline, 'dotnet');
        assert.equal(steps[1].cmd, 'dotnet format "My App.sln" --verify-no-changes');
        assert.equal(steps[1].baseline, 'dotnet');
        assert.match(detectFormat(dir).command, /dotnet format whitespace \. --folder --include \{relfile\}/);
    } finally {
        cleanup();
    }
});

test('.NET: single nested project; global.json version; several projects without solution → no steps', async () => {
    const { detectDotnet } = await import('../lib/detect.mjs');
    const one = tempProject({ 'global.json': { sdk: { version: '10.0.100' } }, 'src/App/App.csproj': '' });
    const many = tempProject({ 'src/A/A.csproj': '', 'src/B/B.csproj': '', 'src/A/bin/X.csproj': '' });
    try {
        assert.deepEqual(detectDotnet(one.dir), { target: 'src/App/App.csproj', version: '10.0', globalJson: true });
        assert.equal(detectDotnet(many.dir).target, null);
        assert.deepEqual(detectVerify(many.dir), []);
    } finally {
        one.cleanup();
        many.cleanup();
    }
});
