#!/usr/bin/env node
// linx MCP launcher — managed by linx, do not edit. Usage: node .linx/mcp-run.mjs <cmd> [args...]
// Windows needs a shell to run .cmd shims (npx) and quoting for paths with spaces.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const quoteWin = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const [cmd, ...args] = process.argv.slice(2);
    const child =
        process.platform === 'win32'
            ? spawn([cmd, ...args].map(quoteWin).join(' '), { stdio: 'inherit', shell: true })
            : spawn(cmd, args, { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code ?? 1));
    child.on('error', (e) => {
        console.error(`[mcp-run] ${cmd}: ${e.message}`);
        process.exit(1);
    });
}
