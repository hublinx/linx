import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import {
    commands,
    context,
    gitlabFeedback,
    gitlabState,
    githubFeedback,
    normalizeIssue,
    parseIssueRef,
    resolveForge,
    rollupState,
    stripAnsi,
} from '../runtime/forge.mjs';
import { tempProject } from './helpers.mjs';

// Fake gh/glab: `routes` maps a substring of the joined args to stdout (string or object).
function fakeCtx(forge, routes, { git = {} } = {}) {
    const calls = [];
    const gitMap = { 'rev-parse --abbrev-ref HEAD': 'feat/x', 'rev-parse origin/feat/x': 'abc123', ...git };
    const ctx = context(process.cwd(), {
        config: { forge, baseBranch: 'main' },
        git: (...a) => gitMap[a.join(' ')] ?? '',
        sleep: () => {},
        run: (bin, args) => {
            const key = args.join(' ');
            calls.push(key);
            const hit = Object.keys(routes).find((k) => key.includes(k));
            if (hit === undefined) return { status: 1, stdout: '', stderr: `no route for ${key}` };
            const out = routes[hit];
            return { status: 0, stdout: typeof out === 'string' ? out : JSON.stringify(out) };
        },
    });
    return { ctx, calls };
}

test('forge resolution and issue references', () => {
    assert.equal(resolveForge({}, 'git@github.com:a/b.git'), 'github');
    assert.equal(resolveForge({}, 'https://gitlab.example.com/a/b.git'), 'gitlab');
    assert.equal(resolveForge({ forge: 'gitlab' }, 'https://git.corp/a/b'), 'gitlab');
    assert.equal(resolveForge({}, 'https://git.corp/a/b'), 'none');
    assert.equal(parseIssueRef('#12'), 12);
    assert.equal(parseIssueRef('https://gitlab.com/g/p/-/issues/34#note_9'), 34);
    assert.equal(parseIssueRef('https://github.com/o/r/issues/56'), 56);
    assert.throws(() => parseIssueRef('abc'));
    assert.throws(() => context(process.cwd(), { config: { forge: 'none' }, git: () => '' }), /No forge/);
});

test('issues normalize the same on both forges', () => {
    const gh = normalizeIssue(
        'github',
        { number: 1, title: 'T', state: 'open', html_url: 'u', user: { login: 'a' }, labels: [{ name: 'bug' }], body: null },
        [{ user: { login: 'b' }, body: 'hi', created_at: 'd' }],
    );
    const gl = normalizeIssue(
        'gitlab',
        { iid: 1, title: 'T', state: 'opened', web_url: 'u', author: { username: 'a' }, labels: ['bug'], description: null },
        [{ author: { username: 'b' }, body: 'hi', created_at: 'd' }, { system: true, body: 'changed label' }],
    );
    assert.deepEqual(gh, gl);
    assert.equal(gh.state, 'open');
    assert.equal(gh.body, '');
});

test('CI state helpers', () => {
    assert.equal(rollupState([]).state, 'none');
    assert.equal(rollupState([{ name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS' }]).state, 'success');
    assert.equal(rollupState([{ name: 'a', status: 'IN_PROGRESS' }]).state, 'pending');
    assert.deepEqual(
        rollupState([
            { name: 'a', status: 'IN_PROGRESS' },
            { name: 'b', status: 'COMPLETED', conclusion: 'FAILURE' },
            { context: 'c', state: 'ERROR' },
        ]),
        { state: 'failed', failed: ['b', 'c'] },
    );
    assert.equal(gitlabState('running'), 'pending');
    assert.equal(gitlabState('canceled'), 'canceled');
    assert.equal(gitlabState('failed'), 'failed');
    assert.equal(rollupState([{ name: 'a', status: 'COMPLETED', conclusion: 'CANCELLED' }]).state, 'canceled');
    assert.equal(parseIssueRef('https://gitlab.com/g/p/-/work_items/7'), 7);
    assert.equal(gitlabState('manual'), 'manual');
    assert.equal(gitlabState(null), 'none');
    assert.equal(stripAnsi('\x1b[31merror\x1b[0m section_start:1:build\rok'), 'error ok');
});

test('review feedback normalizes threads and comments', () => {
    const gh = githubFeedback({
        reviewThreads: {
            nodes: [
                { isResolved: false, isOutdated: false, path: 'a.ts', line: 3, comments: { nodes: [{ author: { login: 'r' }, body: 'fix', url: 'u1' }] } },
                { isResolved: true, path: 'b.ts', line: 1, comments: { nodes: [{ author: { login: 'r' }, body: 'ok', url: 'u2' }] } },
            ],
        },
        reviews: { nodes: [{ author: { login: 'r' }, state: 'CHANGES_REQUESTED', body: 'see comments', url: 'u3' }, { body: '' }] },
        comments: { nodes: [{ author: { login: 'c' }, body: 'nice', url: 'u4' }] },
    });
    assert.deepEqual(gh.map((i) => [i.kind, i.resolved]), [['thread', false], ['thread', true], ['review', false], ['comment', false]]);
    assert.equal(gh[0].body, 'r: fix');

    const gl = gitlabFeedback(
        [
            { notes: [{ id: 7, resolvable: true, resolved: false, author: { username: 'r' }, body: 'fix', position: { new_path: 'a.ts', new_line: 3 } }] },
            { notes: [{ id: 8, resolvable: false, author: { username: 'c' }, body: 'nice' }] },
            { notes: [{ id: 9, system: true, body: 'added 1 commit' }] },
        ],
        'https://gl/mr/1',
    );
    assert.deepEqual(gl.map((i) => [i.kind, i.resolved, i.path, i.line]), [
        ['thread', false, 'a.ts', 3],
        ['comment', false, undefined, undefined],
    ]);
    assert.equal(gl[0].url, 'https://gl/mr/1#note_7');
});

test('github: pr-create returns the open PR instead of opening a duplicate', () => {
    const { ctx, calls } = fakeCtx('github', { 'pr list': [{ number: 5, url: 'https://github.com/o/r/pull/5', state: 'OPEN' }] });
    const r = commands['pr-create'](ctx, { title: 'feat: x', 'body-file': 'x.md' });
    assert.deepEqual(r, { existing: true, number: 5, url: 'https://github.com/o/r/pull/5', state: 'open' });
    assert.ok(!calls.some((c) => c.startsWith('pr create')));
});

test('gitlab: pr-create passes the description file content and parses the MR URL', () => {
    const { dir, cleanup } = tempProject({ 'body.md': 'Closes #3' });
    try {
        const { ctx, calls } = fakeCtx('gitlab', {
            'merge_requests?source_branch': [],
            'mr create': 'Creating merge request...\nhttps://gitlab.com/g/p/-/merge_requests/12\n',
        });
        ctx.cwd = dir;
        const r = commands['pr-create'](ctx, { title: 'feat: x', 'body-file': 'body.md' });
        assert.equal(r.url, 'https://gitlab.com/g/p/-/merge_requests/12');
        assert.equal(r.number, 12);
        const create = calls.find((c) => c.startsWith('mr create'));
        assert.match(create, /--target-branch main/);
        assert.match(create, /--description Closes #3/);
    } finally {
        cleanup();
    }
});

test('github: pr-status summarizes review and checks', () => {
    const { ctx } = fakeCtx('github', {
        'pr list': [{ number: 5, url: 'u', state: 'OPEN' }],
        'pr view': {
            number: 5, url: 'u', title: 't', state: 'OPEN', isDraft: false, reviewDecision: 'CHANGES_REQUESTED',
            statusCheckRollup: [{ name: 'verify', status: 'COMPLETED', conclusion: 'FAILURE' }],
        },
    });
    const r = commands['pr-status'](ctx, {});
    assert.equal(r.review, 'changes_requested');
    assert.equal(r.ci, 'failed');
    assert.deepEqual(r.failedChecks, ['verify']);
});

test('gitlab: pr-status maps MR state and pipeline; missing MR → exists:false', () => {
    const { ctx } = fakeCtx('gitlab', {
        'merge_requests?source_branch': [{ iid: 4, web_url: 'u', state: 'merged' }],
        'merge_requests/4/approvals': { approved: true },
        'merge_requests/4': { iid: 4, web_url: 'u', title: 't', state: 'merged', draft: false, head_pipeline: { status: 'success' } },
    });
    const r = commands['pr-status'](ctx, {});
    assert.deepEqual([r.state, r.review, r.ci], ['merged', 'approved', 'success']);
    const none = fakeCtx('gitlab', { 'merge_requests?source_branch': [] });
    assert.deepEqual(commands['pr-status'](none.ctx, {}), { exists: false });
});

test('ci-status --wait polls until the pipeline for the pushed commit finishes', () => {
    let n = 0;
    const statuses = ['running', 'running', 'failed'];
    const { ctx } = fakeCtx('gitlab', {});
    ctx.run = (bin, args) => {
        const key = args.join(' ');
        if (key.includes('/pipelines?sha=abc123')) return { status: 0, stdout: JSON.stringify([{ id: 1, status: statuses[n++], web_url: 'p' }]) };
        if (key.includes('/pipelines/1/jobs')) return { status: 0, stdout: JSON.stringify([{ id: 9, name: 'test', status: 'failed', web_url: 'j' }]) };
        return { status: 1, stderr: key };
    };
    const r = commands['ci-status'](ctx, { wait: true });
    assert.equal(r.state, 'failed');
    assert.equal(n, 3);
    assert.deepEqual(r.failed, [{ id: 9, name: 'test', url: 'j' }]);
});

test('github: ci-status ignores runs of other commits; ci-log tails failed logs', () => {
    const runs = [
        { databaseId: 1, name: 'ci', status: 'completed', conclusion: 'failure', url: 'r1', headSha: 'abc123' },
        { databaseId: 2, name: 'old', status: 'completed', conclusion: 'failure', url: 'r2', headSha: 'zzz' },
    ];
    const { ctx } = fakeCtx('github', { 'run list': runs, 'run view 1 --log-failed': 'line1\nline2\nboom' });
    const s = commands['ci-status'](ctx, {});
    assert.equal(s.state, 'failed');
    assert.equal(s.runs.length, 1);
    assert.match(commands['ci-log'](ctx, {}), /===== ci — r1\n[\s\S]*boom/);
});

test('missing CLI gives an install hint', () => {
    const { ctx } = fakeCtx('gitlab', {});
    ctx.run = () => ({ error: new Error('ENOENT') });
    assert.throws(() => commands.issue(ctx, { _: ['issue', '1'] }), /glab not found — install it/);
    const info = commands.info(ctx);
    assert.equal(info.installed, false);
    assert.equal(info.authenticated, false);
});

test('info redacts credentials in the remote URL', () => {
    const { ctx } = fakeCtx('github', { '--version': 'gh 2', 'auth status': '' }, {
        git: { 'remote get-url origin': 'https://user:secret@github.com/o/r.git' },
    });
    assert.equal(commands.info(ctx).remote, 'https://github.com/o/r.git');
});

test('CLI prints usage for unknown commands', async () => {
    const { spawnSync } = await import('node:child_process');
    const { PKG_ROOT } = await import('../lib/install.mjs');
    const r = spawnSync(process.execPath, [join(PKG_ROOT, 'runtime', 'forge.mjs'), 'nope'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Usage: node \.linx\/forge\.mjs/);
});
