import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CLI = resolve('src/cli.ts');
// Absolute loader path: the CLI runs from a temp dir where `tsx` can't be resolved by name.
const TSX = pathToFileURL(resolve('node_modules/tsx/dist/esm/index.mjs')).href;
let dir: string;

function run(args: string[], opts: { input?: string; cwd?: string } = {}) {
    const r = spawnSync(process.execPath, ['--import', TSX, CLI, ...args], {
        cwd: opts.cwd ?? dir,
        input: opts.input,
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', OLLAMA_HOST: 'http://127.0.0.1:9' },
    });
    return { code: r.status, out: r.stdout, err: r.stderr };
}

beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'prismify-cli-'));
    cpSync('examples', join(dir, 'examples'), { recursive: true });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('CLI', () => {
    it('previews by default and does not write', () => {
        const before = readFileSync(join(dir, 'examples/messy.js'), 'utf8');
        const r = run(['examples/messy.js']);
        expect(r.code).toBe(0);
        expect(r.out).toContain('n → name');
        expect(r.out).toContain('Preview only');
        expect(readFileSync(join(dir, 'examples/messy.js'), 'utf8')).toBe(before);
    });

    it('--check exits 1 when files would change, 0 when clean', () => {
        writeFileSync(join(dir, 'clean.js'), "export const a = 1;\n");
        expect(run(['examples/messy.js', '--check']).code).toBe(1);
        expect(run(['clean.js', '--check']).code).toBe(0);
    });

    it('--write updates files and a second run is clean', () => {
        writeFileSync(join(dir, 'w.js'), 'function f(u){const n=u.name;return n}\nmodule.exports={f}\n');
        expect(run(['w.js', '--write']).code).toBe(0);
        expect(readFileSync(join(dir, 'w.js'), 'utf8')).toBe('function f(u) {\n  const name = u.name;\n  return name;\n}\nmodule.exports = { f };\n');
        expect(run(['w.js', '--check']).code).toBe(0);
    });

    it('reads stdin and prints to stdout', () => {
        const r = run(['-', '--language', 'py'], { input: 'def f(u):\n    n = u.name\n    return n\n' });
        expect(r.code).toBe(0);
        expect(r.out).toBe('def f(u):\n    name = u.name\n    return name\n');
    });

    it('prints JSON', () => {
        const r = run(['examples/messy.py', '--json', '--refactor']);
        const json = JSON.parse(r.out);
        expect(json[0].file).toBe('examples/messy.py');
        expect(json[0].renames.length).toBeGreaterThan(0);
        expect(json[0].diff).toContain('@@');
    });

    it('processes directories and summarises', () => {
        const r = run(['examples', '--no-diff']);
        expect(r.out).toMatch(/5 files/);
    });

    it('reads .prismifyrc.json', () => {
        writeFileSync(join(dir, '.prismifyrc.json'), JSON.stringify({ rename: false }));
        const r = run(['examples/messy.js', '--json']);
        rmSync(join(dir, '.prismifyrc.json'));
        expect(JSON.parse(r.out)[0].renames).toEqual([]);
    });

    it('rejects unknown styles with exit code 2', () => {
        const r = run(['examples/messy.js', '--style', 'nope']);
        expect(r.code).toBe(2);
        expect(r.err).toMatch(/Unknown style/);
    });

    it('fails clearly when --provider ollama is unreachable', () => {
        const r = run(['examples/messy.js', '--provider', 'ollama']);
        expect(r.code).toBe(2);
        expect(r.err).toMatch(/not reachable/);
    });

    it('lists styles', () => {
        expect(run(['styles']).out).toContain('airbnb');
    });
});
