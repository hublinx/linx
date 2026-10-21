import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { formatCommand, isSensitive, relPath } from '../hooks/post-edit.mjs';
import { openWork, render } from '../hooks/session-start.mjs';
import { PKG_ROOT } from '../lib/install.mjs';
import { tempProject } from './helpers.mjs';

const progress = (status, owner = 'dev') => `---\nslug: x\nstatus: ${status}\nowner: ${owner}\n---\n## Tasks\n`;

test('session-start lists only doing/blocked work, newest first', () => {
    const { dir, cleanup } = tempProject({
        'w/2026-01-01-a/progress.md': progress('doing'),
        'w/2026-02-01-b/progress.md': progress('blocked'),
        'w/2026-03-01-c/progress.md': progress('done'),
        'w/notes.md': '',
    });
    try {
        const work = openWork(join(dir, 'w'));
        assert.deepEqual(
            work.map((w) => w.slug),
            ['2026-02-01-b', '2026-01-01-a'],
        );
        const text = render({ baseBranch: 'develop', paths: { work: 'w' } }, work);
        assert.match(text, /linx-start/);
        assert.match(text, /origin\/develop/);
        assert.match(text, /2026-02-01-b — blocked, owner dev/);
    } finally {
        cleanup();
    }
});

test('session-start is silent without config and speaks with it', () => {
    const script = join(PKG_ROOT, 'hooks', 'session-start.mjs');
    const none = tempProject();
    const withCfg = tempProject({ '.linx/config.json': { baseBranch: 'main' } });
    try {
        const run = (dir) =>
            spawnSync(process.execPath, [script], { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' });
        assert.equal(run(none.dir).stdout, '');
        assert.match(run(withCfg.dir).stdout, /linx-start/);
    } finally {
        none.cleanup();
        withCfg.cleanup();
    }
});

test('post-edit helpers', () => {
    const root = process.cwd();
    assert.equal(relPath(root, join(root, 'src', 'a.ts')), 'src/a.ts');
    assert.equal(relPath(root, join(root, '..', 'x.ts')), null);
    assert.ok(isSensitive('.env.local', ['(^|/)\\.env($|\\.)']));
    assert.ok(!isSensitive('src/env.ts', ['(^|/)\\.env($|\\.)']));
    assert.ok(!isSensitive('a', ['(invalid']));
    assert.equal(formatCommand({ command: 'fmt {file}', extensions: ['.ts'] }, 'a.ts'), 'fmt "a.ts"');
    assert.equal(formatCommand({ command: 'fmt {file}', extensions: ['.ts'] }, 'a.md'), null);
    assert.equal(formatCommand(null, 'a.ts'), null);
    assert.equal(formatCommand({ command: 'f --include {relfile}' }, '/r/src/A.cs', 'src/A.cs'), 'f --include "src/A.cs"');
});

test('post-edit warns on sensitive files with exit 2', () => {
    const script = join(PKG_ROOT, 'hooks', 'post-edit.mjs');
    const { dir, cleanup } = tempProject({
        '.linx/config.json': { sensitivePaths: ['(^|/)\\.env($|\\.)'], format: null },
        '.env': 'X=1',
    });
    try {
        const run = (file) =>
            spawnSync(process.execPath, [script], {
                env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
                input: JSON.stringify({ tool_input: { file_path: join(dir, file) } }),
                encoding: 'utf8',
            });
        const hit = run('.env');
        assert.equal(hit.status, 2);
        assert.match(hit.stderr, /sensitivePaths/);
        assert.equal(run('src/a.ts').status, 0);
    } finally {
        cleanup();
    }
});
