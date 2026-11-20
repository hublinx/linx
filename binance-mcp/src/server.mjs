#!/usr/bin/env node
// Binance MCP server — không cần auth.
//   node src/server.mjs            HTTP (Streamable HTTP) tại http://0.0.0.0:PORT/mcp
//   node src/server.mjs --stdio    stdio (Claude Desktop, Cursor... chạy local)

import { createServer } from 'node:http';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBinance } from './binance.mjs';
import { buildServer } from './tools.mjs';

const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id',
    'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version',
};

function readBody(req, limit = 1_000_000) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) {
                reject(Object.assign(new Error('Body quá lớn'), { status: 413 }));
                req.destroy();
            } else chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

const json = (res, status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json', ...CORS });
    res.end(JSON.stringify(obj));
};

/** HTTP app, tách riêng để test. */
export function createHttpServer({ binance = createBinance(), log = console } = {}) {
    return createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        try {
            if (req.method === 'OPTIONS') {
                res.writeHead(204, CORS);
                return res.end();
            }
            if (url.pathname === '/health' || url.pathname === '/') {
                return json(res, 200, { ok: true, name: 'binance-mcp', mcp_endpoint: '/mcp' });
            }
            if (url.pathname !== '/mcp') return json(res, 404, { error: 'Not found' });
            if (req.method !== 'POST') {
                // Stateless: không có luồng SSE GET / không có session để DELETE
                return json(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
            }
            for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
            const raw = await readBody(req);
            let body;
            try {
                body = JSON.parse(raw);
            } catch {
                return json(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
            }
            // Stateless: mỗi request một server + transport mới
            const server = buildServer(binance);
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
            res.on('close', () => {
                transport.close();
                server.close();
            });
            await server.connect(transport);
            await transport.handleRequest(req, res, body);
        } catch (err) {
            log.error(`[http] ${err.stack || err.message}`);
            if (!res.headersSent) json(res, err.status || 500, { jsonrpc: '2.0', error: { code: -32603, message: err.message }, id: null });
        }
    });
}

const isMain = (() => {
    try {
        return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
})();
if (isMain) {
    if (process.argv.includes('--stdio')) {
        const server = buildServer(createBinance());
        await server.connect(new StdioServerTransport());
        console.error('binance-mcp đang chạy qua stdio');
    } else {
        const port = Number(process.env.PORT || 3000);
        const http = createHttpServer();
        http.listen(port, '0.0.0.0', () => console.log(`binance-mcp: http://0.0.0.0:${port}/mcp (health: /health)`));
        const stop = () => http.close(() => process.exit(0));
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
    }
}
