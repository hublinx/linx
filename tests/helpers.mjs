import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export function tempProject(files = {}, { git = false } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'linx-test-'));
    for (const [rel, content] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, rel)), { recursive: true });
        writeFileSync(join(dir, rel), typeof content === 'string' ? content : JSON.stringify(content));
    }
    if (git) spawnSync('git', ['init', '-q', '-b', 'main', dir]);
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
