#!/usr/bin/env node
// linx PostToolUse hook (Edit/Write): run the project's formatter on the edited file and warn about
// sensitive files (exit 2 shows the message to the agent). Both come from .linx/config.json.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function relPath(root, file) {
    const rel = relative(root, resolve(root, file)).split('\\').join('/');
    return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? null : rel;
}

export function isSensitive(rel, patterns = []) {
    return patterns.some((p) => {
        try {
            return new RegExp(p).test(rel);
        } catch {
            return false;
        }
    });
}

export function formatCommand(format, file) {
    if (!format?.command) return null;
    if (format.extensions && !format.extensions.includes(extname(file))) return null;
    return format.command.replaceAll('{file}', `"${file}"`);
}

function isShadowed(root, self, name) {
    const rel = relative(root, self);
    const insideProject = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    return !insideProject && existsSync(join(root, '.linx', 'hooks', name));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
    if (isShadowed(root, fileURLToPath(import.meta.url), 'post-edit.mjs')) process.exit(0);
    const configFile = join(root, '.linx', 'config.json');
    if (!existsSync(configFile)) process.exit(0);
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    let config;
    let input;
    try {
        config = JSON.parse(readFileSync(configFile, 'utf8'));
        input = JSON.parse(raw || '{}');
    } catch {
        process.exit(0);
    }
    const file = input.tool_input?.file_path ?? input.file_path;
    const rel = file ? relPath(root, file) : null;
    // Files outside the repo (e.g. a shared work folder) are not governed by this repo's rules.
    if (!rel) process.exit(0);
    const cmd = formatCommand(config.format, resolve(root, file));
    if (cmd && existsSync(resolve(root, file))) {
        spawnSync(cmd, { cwd: root, shell: true, stdio: 'ignore', timeout: 30_000 });
    }
    if (isSensitive(rel, config.sensitivePaths)) {
        process.stderr.write(
            `⚠️ ${rel} matches sensitivePaths in .linx/config.json. Confirm this change is required and record why in progress.md.\n`,
        );
        process.exit(2);
    }
}
