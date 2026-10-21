import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parsers, regressions, runStep, selectSteps } from '../runtime/verify.mjs';
import { tempProject } from './helpers.mjs';

test('tsc parser counts per file and global errors', () => {
    const out = [
        'src/a.ts(1,2): error TS2322: x',
        'src/a.ts(3,4): error TS2322: y',
        'src/b.ts(1,1): error TS7006: z',
        "error TS2688: Cannot find type definition file for 'node'.",
    ].join('\n');
    assert.deepEqual(parsers.tsc(out, process.cwd()), { 'src/a.ts': 2, 'src/b.ts': 1, '<global>': 1 });
});

test('eslint-json and ruff-json parsers', () => {
    const cwd = process.cwd();
    const eslint = JSON.stringify([
        { filePath: join(cwd, 'a.js'), errorCount: 2 },
        { filePath: join(cwd, 'b.js'), errorCount: 0 },
    ]);
    assert.deepEqual(parsers['eslint-json'](`noise\n${eslint}`, cwd), { 'a.js': 2 });
    assert.equal(parsers['eslint-json']('not json', cwd), null);
    const ruff = JSON.stringify([{ filename: join(cwd, 'x.py') }, { filename: join(cwd, 'x.py') }]);
    assert.deepEqual(parsers['ruff-json'](ruff, cwd), { 'x.py': 2 });
});

test('regressions only report increases', () => {
    assert.deepEqual(regressions({ a: 2, b: 1, c: 1 }, { a: 2, b: 3 }), ['c: 0 → 1']);
});

test('selectSteps honors --only, --skip and default:false', () => {
    const steps = [{ name: 'lint' }, { name: 'test' }, { name: 'e2e', default: false }];
    assert.deepEqual(selectSteps(steps, []).map((s) => s.name), ['lint', 'test']);
    assert.deepEqual(selectSteps(steps, ['--only=e2e']).map((s) => s.name), ['e2e']);
    assert.deepEqual(selectSteps(steps, ['--skip=test']).map((s) => s.name), ['lint']);
});

test('baseline step passes on known errors, fails on new ones, and can be updated', () => {
    const { dir, cleanup } = tempProject();
    try {
        const step = { name: 'typecheck', cmd: 'x', baseline: 'tsc' };
        const fake = (stdout, status = 1) => () => ({ stdout, stderr: '', status });
        const one = 'src/a.ts(1,1): error TS1: x';
        const r1 = runStep(step, dir, { updateBaseline: true, run: fake(one) });
        assert.ok(r1.ok);
        assert.ok(existsSync(join(dir, '.linx', 'baseline', 'typecheck.json')));
        assert.deepEqual(JSON.parse(readFileSync(join(dir, '.linx', 'baseline', 'typecheck.json'), 'utf8')), {
            'src/a.ts': 1,
        });
        assert.ok(runStep(step, dir, { run: fake(one) }).ok);
        const r3 = runStep(step, dir, { run: fake(`${one}\nsrc/b.ts(1,1): error TS1: y`) });
        assert.equal(r3.ok, false);
        assert.match(r3.detail, /src\/b\.ts: 0 → 1/);
        // Non-zero exit with nothing parsed = the tool itself crashed.
        assert.equal(runStep(step, dir, { run: fake('Segmentation fault') }).ok, false);
    } finally {
        cleanup();
    }
});

test('plain step uses the exit code', () => {
    const ok = runStep({ name: 't', cmd: 'node -e "process.exit(0)"' }, process.cwd());
    const fail = runStep({ name: 't', cmd: 'node -e "console.log(42);process.exit(3)"' }, process.cwd());
    assert.ok(ok.ok);
    assert.equal(fail.ok, false);
    assert.match(fail.detail, /42/);
});

test('dotnet parser counts warnings and errors per file, once per distinct line', () => {
    const cwd = process.cwd();
    const f = join(cwd, 'src', 'Api', 'Program.cs');
    const out = [
        `  ${f}(12,5): warning CS8618: Non-nullable property 'Name' [${join(cwd, 'src', 'Api', 'Api.csproj')}]`,
        `  ${f}(12,5): warning CS8618: Non-nullable property 'Name' [${join(cwd, 'src', 'Api', 'Api.csproj')}]`,
        `${f}(20,1): error WHITESPACE: Fix whitespace formatting. [x.csproj]`,
        `${join(cwd, 'src', 'Api', 'Api.csproj')} : error NU1101: Unable to find package Foo.`,
        'MSBUILD : error MSB1009: Project file does not exist.',
        'Build succeeded.',
        '    2 Warning(s)',
    ].join('\r\n');
    assert.deepEqual(parsers.dotnet(out, cwd), {
        'src/Api/Program.cs': 2,
        'src/Api/Api.csproj': 1,
        '<global>': 1,
    });
    assert.deepEqual(parsers.dotnet('Build succeeded.\n    0 Warning(s)\n    0 Error(s)', cwd), {});
});

test('dotnet baseline reads diagnostics from stderr too', () => {
    const { dir, cleanup } = tempProject();
    try {
        const step = { name: 'format', cmd: 'x', baseline: 'dotnet' };
        const r = runStep(step, dir, {
            run: () => ({ stdout: '', stderr: 'src/A.cs(1,1): error WHITESPACE: Fix whitespace formatting.', status: 2 }),
        });
        assert.equal(r.ok, false);
        assert.match(r.detail, /src\/A\.cs: 0 → 1/);
    } finally {
        cleanup();
    }
});
