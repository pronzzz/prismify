/**
 * Expand CLI paths into the list of files to process.
 *
 * Directories are walked recursively. Inside a git repository, `git ls-files`
 * is used so `.gitignore` is respected. Common build and dependency folders
 * are always skipped. Files named explicitly are always included.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { detectLanguage } from '../languages/index.js';

export const DEFAULT_IGNORES = [
    'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.turbo',
    '.venv', 'venv', 'env', '__pycache__', '.mypy_cache', '.pytest_cache', '.tox', 'target',
    'vendor', '.gradle', '*.min.js', '*.bundle.js', '*.d.ts',
];

export interface ExpandResult {
    files: string[];
    /** Paths that were given but don't exist or aren't supported. */
    missing: string[];
    unsupported: string[];
}

export function expandPaths(inputs: string[], ignore: string[] = [], cwd = process.cwd()): ExpandResult {
    const matchers = [...DEFAULT_IGNORES, ...ignore].map(globToRegex);
    const isIgnored = (rel: string) => {
        const parts = rel.split(/[\\/]/);
        return matchers.some(re => re.test(rel) || parts.some(p => re.test(p)));
    };

    const files = new Set<string>();
    const missing: string[] = [];
    const unsupported: string[] = [];

    for (const input of inputs) {
        const abs = resolve(cwd, input);
        let st;
        try {
            st = statSync(abs);
        } catch {
            missing.push(input);
            continue;
        }
        if (st.isFile()) {
            if (detectLanguage(abs)) files.add(abs);
            else unsupported.push(input);
            continue;
        }
        if (!st.isDirectory()) continue;
        const listed = gitFiles(abs) ?? walk(abs);
        for (const file of listed) {
            const rel = relative(abs, file);
            if (!detectLanguage(file) || isIgnored(rel)) continue;
            files.add(file);
        }
    }

    return { files: [...files].sort(), missing, unsupported };
}

function gitFiles(dir: string): string[] | null {
    const r = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error || r.status !== 0) return null;
    return r.stdout.split('\0').filter(Boolean).map(f => join(dir, f)).filter(f => {
        try {
            return statSync(f).isFile();
        } catch {
            return false; // deleted but still tracked
        }
    });
}

function walk(dir: string, out: string[] = []): string[] {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const e of entries) {
        if (e.name.startsWith('.') && e.name !== '.') continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
            if (DEFAULT_IGNORES.includes(e.name)) continue;
            walk(full, out);
        } else if (e.isFile()) {
            out.push(full);
        }
    }
    return out;
}

/** Minimal glob → RegExp: `**`, `*`, `?`, trailing `/` for directories. */
export function globToRegex(glob: string): RegExp {
    let g = glob.trim().replace(/\\/g, '/');
    const dirOnly = g.endsWith('/');
    if (dirOnly) g = g.slice(0, -1);
    if (g.startsWith('./')) g = g.slice(2);
    let re = '';
    for (let i = 0; i < g.length; i++) {
        const ch = g[i];
        if (ch === '*' && g[i + 1] === '*') {
            re += '.*';
            i++;
            if (g[i + 1] === '/') i++;
        } else if (ch === '*') re += '[^/]*';
        else if (ch === '?') re += '[^/]';
        else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${re}${dirOnly ? '(/.*)?' : ''}$`);
}

export function displayPath(file: string, cwd = process.cwd()): string {
    const rel = relative(cwd, file);
    return rel && !rel.startsWith('..') ? rel.split(sep).join('/') : file;
}
