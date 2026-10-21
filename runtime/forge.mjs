#!/usr/bin/env node
// linx forge bridge — managed by linx, do not edit.
// One interface over GitHub (`gh`) and GitLab (`glab`) so skills read issues, open PRs/MRs, read review
// feedback and follow CI the same way on both. Prints JSON (ci-log: plain text); errors go to stderr, exit 1.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const USAGE = `Usage: node .linx/forge.mjs <command> [options]
  info                                       forge, CLI, auth, branch, base
  issue <number|url>                         issue title, body, labels, comments
  pr-create --title=<t> --body-file=<f> [--base=<b>] [--head=<branch>] [--draft]
  pr-status [--branch=<b>]                   PR/MR state, review decision, CI summary
  pr-comments [--branch=<b>] [--all]         unresolved review threads + comments (--all: resolved too)
  ci-status [--branch=<b>] [--wait] [--timeout=<minutes, default 9>]
  ci-log [--branch=<b>]                      tail of the failed jobs' logs`;

const BIN = { github: 'gh', gitlab: 'glab' };
const INSTALL = { github: 'https://cli.github.com', gitlab: 'https://gitlab.com/gitlab-org/cli' };
const BAD = ['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'];
const enc = encodeURIComponent;
const tail = (s, n) => s.trimEnd().split(/\r?\n/).slice(-n).join('\n');

export function parseArgs(argv) {
    const opts = { _: [] };
    for (const arg of argv) {
        const m = arg.match(/^--([\w-]+)(?:=([\s\S]*))?$/);
        if (!m) opts._.push(arg);
        else opts[m[1]] = m[2] ?? true;
    }
    return opts;
}

export function resolveForge(config, remoteUrl) {
    if (config.forge) return config.forge;
    if (/github/i.test(remoteUrl)) return 'github';
    if (/gitlab/i.test(remoteUrl)) return 'gitlab';
    return 'none';
}

export function parseIssueRef(ref) {
    const s = String(ref ?? '').trim();
    const url = s.match(/\/(?:issues|work_items)\/(\d+)/);
    if (url) return Number(url[1]);
    const m = s.match(/^#?(\d+)$/);
    if (m) return Number(m[1]);
    throw new Error(`Not an issue reference: "${s}" (use 123, #123 or the issue URL)`);
}

export function normalizeIssue(forge, issue, notes) {
    const gh = forge === 'github';
    return {
        number: gh ? issue.number : issue.iid,
        title: issue.title,
        state: issue.state === 'opened' ? 'open' : issue.state,
        url: gh ? issue.html_url : issue.web_url,
        author: gh ? issue.user?.login : issue.author?.username,
        labels: (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)),
        body: (gh ? issue.body : issue.description) ?? '',
        comments: notes
            .filter((n) => !n.system)
            .map((n) => ({ author: gh ? n.user?.login : n.author?.username, body: n.body, createdAt: n.created_at })),
    };
}

// GitHub check runs / status contexts (statusCheckRollup, or `gh run list` mapped to the same shape).
// Precedence: failed > pending > canceled (usually superseded by a newer push) > success.
export function rollupState(items = []) {
    if (!items.length) return { state: 'none', failed: [] };
    const failed = [];
    let pending = false;
    let canceled = false;
    for (const c of items) {
        const name = c.name ?? c.context ?? 'check';
        const status = String(c.status ?? '').toUpperCase();
        const state = String(c.state ?? '').toUpperCase();
        if (!status && state) {
            if (state === 'PENDING' || state === 'EXPECTED') pending = true;
            else if (state === 'FAILURE' || state === 'ERROR') failed.push(name);
        } else if (status !== 'COMPLETED') pending = true;
        else if (BAD.includes(String(c.conclusion ?? '').toUpperCase())) failed.push(name);
        else if (String(c.conclusion ?? '').toUpperCase() === 'CANCELLED') canceled = true;
    }
    const state = failed.length ? 'failed' : pending ? 'pending' : canceled ? 'canceled' : 'success';
    return { state, failed };
}

export function gitlabState(status) {
    if (!status || status === 'skipped') return 'none';
    if (status === 'success') return 'success';
    if (status === 'manual') return 'manual';
    if (status === 'failed') return 'failed';
    if (status === 'canceled' || status === 'canceling') return 'canceled';
    return 'pending';
}

export function githubFeedback(pr) {
    const out = [];
    for (const t of pr.reviewThreads?.nodes ?? []) {
        const cs = t.comments?.nodes ?? [];
        if (!cs.length) continue;
        out.push({
            kind: 'thread',
            resolved: t.isResolved,
            outdated: t.isOutdated,
            path: t.path,
            line: t.line,
            author: cs[0].author?.login,
            url: cs[0].url,
            body: cs.map((c) => `${c.author?.login}: ${c.body}`).join('\n\n'),
        });
    }
    for (const r of pr.reviews?.nodes ?? [])
        if (r.body?.trim())
            out.push({ kind: 'review', state: r.state, resolved: false, author: r.author?.login, url: r.url, body: r.body });
    for (const c of pr.comments?.nodes ?? [])
        out.push({ kind: 'comment', resolved: false, author: c.author?.login, url: c.url, body: c.body });
    return out;
}

export function gitlabFeedback(discussions, webUrl) {
    const out = [];
    for (const d of discussions) {
        const notes = (d.notes ?? []).filter((n) => !n.system);
        if (!notes.length) continue;
        const first = notes[0];
        const resolvable = notes.some((n) => n.resolvable);
        out.push({
            kind: first.position || resolvable ? 'thread' : 'comment',
            resolved: resolvable && notes.every((n) => !n.resolvable || n.resolved),
            path: first.position?.new_path ?? first.position?.old_path,
            line: first.position?.new_line ?? first.position?.old_line,
            author: first.author?.username,
            url: `${webUrl}#note_${first.id}`,
            body: notes.map((n) => `${n.author?.username}: ${n.body}`).join('\n\n'),
        });
    }
    return out;
}

export const stripAnsi = (s) =>
    s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/section_(start|end):\d+:[\w.-]+\r?/g, '');

const REVIEW = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes_requested', REVIEW_REQUIRED: 'pending' };

function cli(ctx, args) {
    const r = ctx.run(ctx.bin, args);
    if (r.error) throw new Error(`${ctx.bin} not found — install it (${INSTALL[ctx.forge]}) and run "${ctx.bin} auth login"`);
    if (r.status !== 0) {
        const msg = tail(`${r.stderr ?? ''}\n${r.stdout ?? ''}`.trim(), 5);
        throw new Error(`${ctx.bin} ${args.slice(0, 2).join(' ')} failed:\n${msg}`);
    }
    return r.stdout ?? '';
}
const api = (ctx, path) => JSON.parse(cli(ctx, ['api', path]) || 'null');
const branchOf = (ctx, opts) => (typeof opts.branch === 'string' ? opts.branch : ctx.git('rev-parse', '--abbrev-ref', 'HEAD'));

function findPr(ctx, branch) {
    if (ctx.forge === 'github') {
        const list = JSON.parse(
            cli(ctx, ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '1', '--json', 'number,url,state']),
        );
        return list[0] ? { number: list[0].number, url: list[0].url, state: list[0].state.toLowerCase() } : null;
    }
    const [mr] = api(
        ctx,
        `projects/:id/merge_requests?source_branch=${enc(branch)}&state=all&order_by=created_at&sort=desc&per_page=1`,
    );
    return mr ? { number: mr.iid, url: mr.web_url, state: mr.state === 'opened' ? 'open' : mr.state } : null;
}

function ciOnce(ctx, branch) {
    const sha = ctx.git('rev-parse', `origin/${branch}`) || ctx.git('rev-parse', branch);
    if (ctx.forge === 'github') {
        const runs = JSON.parse(
            cli(ctx, ['run', 'list', '--branch', branch, '--limit', '30', '--json', 'databaseId,name,status,conclusion,url,headSha']),
        ).filter((r) => r.headSha === sha);
        const { state } = rollupState(runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion })));
        const failed = runs
            .filter((r) => BAD.includes(String(r.conclusion ?? '').toUpperCase()))
            .map((r) => ({ id: r.databaseId, name: r.name, url: r.url }));
        return { sha, state, failed, runs: runs.map((r) => ({ name: r.name, status: r.conclusion || r.status, url: r.url })) };
    }
    const [p] = api(ctx, `projects/:id/pipelines?sha=${sha}&order_by=id&sort=desc&per_page=1`) ?? [];
    if (!p) return { sha, state: 'none', failed: [] };
    const jobs = api(ctx, `projects/:id/pipelines/${p.id}/jobs?per_page=100`) ?? [];
    const failed = jobs
        .filter((j) => j.status === 'failed' && !j.allow_failure)
        .map((j) => ({ id: j.id, name: j.name, url: j.web_url }));
    return { sha, state: gitlabState(p.status), failed, pipeline: { id: p.id, status: p.status, url: p.web_url } };
}

export const commands = {
    info(ctx) {
        const v = ctx.run(ctx.bin, ['--version']);
        const installed = !v.error && v.status === 0;
        return {
            forge: ctx.forge,
            cli: ctx.bin,
            installed,
            authenticated: installed && ctx.run(ctx.bin, ['auth', 'status']).status === 0,
            branch: ctx.git('rev-parse', '--abbrev-ref', 'HEAD'),
            base: ctx.base,
            // Never echo credentials embedded in the remote URL.
            remote: ctx.git('remote', 'get-url', 'origin').replace(/\/\/[^@/]+@/, '//'),
        };
    },

    issue(ctx, opts) {
        const n = parseIssueRef(opts._[1]);
        if (ctx.forge === 'github') {
            const issue = api(ctx, `repos/{owner}/{repo}/issues/${n}`);
            const notes = issue.comments ? api(ctx, `repos/{owner}/{repo}/issues/${n}/comments?per_page=100`) : [];
            return normalizeIssue('github', issue, notes);
        }
        const issue = api(ctx, `projects/:id/issues/${n}`);
        const notes = api(ctx, `projects/:id/issues/${n}/notes?per_page=100&sort=asc`);
        return normalizeIssue('gitlab', issue, notes);
    },

    'pr-create'(ctx, opts) {
        if (typeof opts.title !== 'string' || typeof opts['body-file'] !== 'string')
            throw new Error('pr-create needs --title=<title> and --body-file=<file>');
        const head = typeof opts.head === 'string' ? opts.head : branchOf(ctx, opts);
        const base = typeof opts.base === 'string' ? opts.base : ctx.base;
        const existing = findPr(ctx, head);
        if (existing?.state === 'open') return { existing: true, ...existing };
        const file = resolve(ctx.cwd, opts['body-file']);
        const draft = opts.draft ? ['--draft'] : [];
        const out =
            ctx.forge === 'github'
                ? cli(ctx, ['pr', 'create', '--base', base, '--head', head, '--title', opts.title, '--body-file', file, ...draft])
                : cli(ctx, [
                      'mr', 'create', '--source-branch', head, '--target-branch', base, '--title', opts.title,
                      '--description', readFileSync(file, 'utf8'), '--remove-source-branch', '--yes', ...draft,
                  ]);
        const url = out.match(/https?:\/\/\S+\/(?:pull|merge_requests)\/\d+/)?.[0] ?? out.trim().split(/\s+/).pop();
        return { existing: false, url, number: Number(url.match(/(\d+)$/)?.[1]) || undefined, state: 'open' };
    },

    'pr-status'(ctx, opts) {
        const pr = findPr(ctx, branchOf(ctx, opts));
        if (!pr) return { exists: false };
        if (ctx.forge === 'github') {
            const v = JSON.parse(
                cli(ctx, ['pr', 'view', String(pr.number), '--json', 'number,url,title,state,isDraft,reviewDecision,statusCheckRollup']),
            );
            const ci = rollupState(v.statusCheckRollup ?? []);
            return {
                exists: true, number: v.number, url: v.url, title: v.title, state: v.state.toLowerCase(), draft: v.isDraft,
                review: REVIEW[v.reviewDecision] ?? 'none', ci: ci.state, failedChecks: ci.failed,
            };
        }
        const mr = api(ctx, `projects/:id/merge_requests/${pr.number}`);
        let approved = false;
        try {
            approved = Boolean(api(ctx, `projects/:id/merge_requests/${pr.number}/approvals`)?.approved);
        } catch {
            // Approvals API unavailable on this instance — leave as not approved.
        }
        return {
            exists: true, number: mr.iid, url: mr.web_url, title: mr.title,
            state: mr.state === 'opened' || mr.state === 'locked' ? 'open' : mr.state, draft: Boolean(mr.draft),
            review: approved ? 'approved' : 'pending', ci: gitlabState(mr.head_pipeline?.status), failedChecks: [],
        };
    },

    'pr-comments'(ctx, opts) {
        const pr = findPr(ctx, branchOf(ctx, opts));
        if (!pr) throw new Error('No PR/MR for this branch');
        let items;
        if (ctx.forge === 'github') {
            const query = `query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$n){
reviewThreads(first:100){nodes{isResolved isOutdated path line comments(first:50){nodes{author{login} body url}}}}
reviews(first:50){nodes{author{login} state body url}} comments(first:100){nodes{author{login} body url}}}}}`;
            const data = JSON.parse(
                cli(ctx, ['api', 'graphql', '-f', `query=${query}`, '-F', 'owner={owner}', '-F', 'repo={repo}', '-F', `n=${pr.number}`]),
            );
            items = githubFeedback(data.data.repository.pullRequest);
        } else {
            items = gitlabFeedback(api(ctx, `projects/:id/merge_requests/${pr.number}/discussions?per_page=100`), pr.url);
        }
        return { pr: pr.url, items: opts.all ? items : items.filter((i) => !i.resolved) };
    },

    'ci-status'(ctx, opts) {
        const branch = branchOf(ctx, opts);
        if (!opts.wait) return ciOnce(ctx, branch);
        const start = Date.now();
        const deadline = start + Number(opts.timeout ?? 9) * 60_000;
        for (;;) {
            const r = ciOnce(ctx, branch);
            // A just-pushed commit may take a few minutes to get a pipeline: keep waiting on "none" at first.
            const settling = r.state === 'pending' || (r.state === 'none' && Date.now() - start < 3 * 60_000);
            if (!settling) return r;
            if (Date.now() >= deadline) return { ...r, timedOut: true };
            ctx.sleep(30_000);
        }
    },

    'ci-log'(ctx, opts) {
        const r = ciOnce(ctx, branchOf(ctx, opts));
        if (!r.failed.length) return `No failed jobs for ${r.sha} (state: ${r.state}).\n`;
        const parts = r.failed.slice(0, 3).map((f) => {
            const log =
                ctx.forge === 'github'
                    ? cli(ctx, ['run', 'view', String(f.id), '--log-failed'])
                    : cli(ctx, ['api', `projects/:id/jobs/${f.id}/trace`]);
            return `===== ${f.name} — ${f.url}\n${tail(stripAnsi(log), 150)}`;
        });
        return parts.join('\n\n') + '\n';
    },
};

export function context(cwd, overrides = {}) {
    const file = join(cwd, '.linx', 'config.json');
    const config = overrides.config ?? (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {});
    const git =
        overrides.git ??
        ((...args) => {
            const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
            return r.status === 0 ? r.stdout.trim() : '';
        });
    const forge = resolveForge(config, git('remote', 'get-url', 'origin'));
    if (!BIN[forge]) throw new Error('No forge: set "forge" to "github" or "gitlab" in .linx/config.json');
    return {
        cwd,
        forge,
        bin: BIN[forge],
        base: config.baseBranch ?? 'main',
        git,
        run: overrides.run ?? ((bin, args) => spawnSync(bin, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })),
        sleep: overrides.sleep ?? ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)),
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const opts = parseArgs(process.argv.slice(2));
    const command = commands[opts._[0]];
    if (!command) {
        console.error(USAGE);
        process.exit(1);
    }
    try {
        const out = command(context(process.cwd()), opts);
        process.stdout.write(typeof out === 'string' ? out : JSON.stringify(out, null, 2) + '\n');
    } catch (e) {
        console.error(`forge: ${e.message}`);
        process.exit(1);
    }
}
