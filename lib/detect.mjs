// Detect project defaults for .linx/config.json: verify steps, formatter, base branch, forge, agent tools.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const readJson = (p) => {
    try {
        return JSON.parse(readFileSync(p, 'utf8'));
    } catch {
        return null;
    }
};
const has = (dir, ...names) => names.some((n) => existsSync(join(dir, n)));
const git = (dir, ...args) => {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : '';
};

export function packageManager(dir) {
    if (has(dir, 'pnpm-lock.yaml')) return 'pnpm';
    if (has(dir, 'yarn.lock')) return 'yarn';
    if (has(dir, 'bun.lockb', 'bun.lock')) return 'bun';
    return 'npm';
}

// Solution-style tsconfig (references + no own files) needs `tsc -b`; plain --noEmit would check nothing.
function tscCommand(dir) {
    const text = readText(join(dir, 'tsconfig.json'));
    const solution = /"references"\s*:/.test(text) && /"files"\s*:\s*\[\s*\]/.test(text);
    return solution ? 'npx tsc -b --pretty false' : 'npx tsc --noEmit --pretty false';
}

function nodeSteps(dir, pkg) {
    const pm = packageManager(dir);
    const scripts = pkg.scripts ?? {};
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const script = (name) =>
        scripts[name] && !/no test specified/.test(scripts[name]) ? `${pm} run ${name}` : null;
    const steps = [];
    if (has(dir, 'tsconfig.json')) steps.push({ name: 'typecheck', cmd: tscCommand(dir), baseline: 'tsc' });
    else if (script('typecheck')) steps.push({ name: 'typecheck', cmd: script('typecheck') });
    if (deps.eslint) steps.push({ name: 'lint', cmd: 'npx eslint . -f json', baseline: 'eslint-json' });
    else if (script('lint')) steps.push({ name: 'lint', cmd: script('lint') });
    if (script('test')) steps.push({ name: 'test', cmd: script('test') });
    if (script('build')) steps.push({ name: 'build', cmd: script('build') });
    return steps;
}

function pythonSteps(dir) {
    const reqs = readdirSync(dir)
        .filter((f) => /^requirements.*\.txt$/.test(f))
        .map((f) => readText(join(dir, f)))
        .join('\n');
    const text = `${readText(join(dir, 'pyproject.toml'))}\n${readText(join(dir, 'setup.cfg'))}\n${reqs}`;
    const steps = [];
    if (/\bruff\b/.test(text) || has(dir, 'ruff.toml', '.ruff.toml'))
        steps.push({ name: 'lint', cmd: 'ruff check . --output-format json', baseline: 'ruff-json' });
    if (/\bmypy\b/.test(text) || has(dir, 'mypy.ini')) steps.push({ name: 'typecheck', cmd: 'mypy .' });
    if (/\bpytest\b/.test(text) || has(dir, 'pytest.ini', 'tests')) steps.push({ name: 'test', cmd: 'pytest -q' });
    return steps;
}

export function detectVerify(dir) {
    const pkg = readJson(join(dir, 'package.json'));
    if (pkg) return nodeSteps(dir, pkg);
    if (has(dir, 'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt')) return pythonSteps(dir);
    if (has(dir, 'go.mod'))
        return [
            { name: 'vet', cmd: 'go vet ./...' },
            { name: 'test', cmd: 'go test ./...' },
            { name: 'build', cmd: 'go build ./...' },
        ];
    if (has(dir, 'Cargo.toml'))
        return [
            { name: 'lint', cmd: 'cargo clippy --all-targets' },
            { name: 'test', cmd: 'cargo test' },
        ];
    if (has(dir, 'pom.xml')) return [{ name: 'test', cmd: 'mvn -q verify' }];
    if (has(dir, 'gradlew')) return [{ name: 'test', cmd: './gradlew check' }];
    return [];
}

export function detectFormat(dir) {
    const pkg = readJson(join(dir, 'package.json'));
    const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
    if (deps.prettier)
        return {
            command: 'npx --no-install prettier --write {file}',
            extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.scss', '.vue'],
        };
    if (/\bruff\b/.test(readText(join(dir, 'pyproject.toml'))) || has(dir, 'ruff.toml', '.ruff.toml'))
        return { command: 'ruff format {file}', extensions: ['.py'] };
    if (has(dir, 'go.mod')) return { command: 'gofmt -w {file}', extensions: ['.go'] };
    if (has(dir, 'Cargo.toml')) return { command: 'rustfmt {file}', extensions: ['.rs'] };
    return null;
}

export function detectBaseBranch(dir) {
    const head = git(dir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
    if (head) return head.replace(/^origin\//, '');
    for (const name of ['main', 'master', 'develop']) if (git(dir, 'rev-parse', '--verify', '--quiet', name)) return name;
    return 'main';
}

export function detectForge(dir) {
    const url = git(dir, 'remote', 'get-url', 'origin');
    if (/github/i.test(url)) return 'github';
    if (/gitlab/i.test(url)) return 'gitlab';
    return 'none';
}

export function detectTools(dir) {
    const tools = ['claude'];
    if (has(dir, '.cursor')) tools.push('cursor');
    if (has(dir, '.agents', '.codex')) tools.push('agents');
    return tools;
}
