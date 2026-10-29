/**
 * Git pre-commit hook.
 *
 * `check` mode (default) blocks the commit when staged files need changes.
 * `write` mode fixes staged files and re-stages them.
 * Both default to formatting only (`--no-rename`); pass other flags with `args`.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const MARKER = '# prismify-hook';

export type HookMode = 'check' | 'write';

export function hookScript(mode: HookMode, args: string): string {
    const action = mode === 'write'
        ? `$PRISMIFY --write ${args} $FILES || exit 1
git add $FILES`
        : `if ! $PRISMIFY --check ${args} $FILES; then
  echo ""
  echo "Prismify: some staged files need changes. Run: prismify --write ${args} <files>"
  exit 1
fi`;
    return `#!/bin/sh
${MARKER} (mode: ${mode})
# Runs Prismify on staged JavaScript, TypeScript, Python and Java files.

FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\\.(js|jsx|mjs|cjs|ts|tsx|mts|cts|py|pyi|java)$')
[ -z "$FILES" ] && exit 0

if command -v prismify >/dev/null 2>&1; then
  PRISMIFY=prismify
else
  PRISMIFY="npx --no-install prismify"
fi

${action}
`;
}

function hooksDir(repoPath: string): string | null {
    const r = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: repoPath, encoding: 'utf8' });
    if (r.status !== 0) return null;
    return resolve(repoPath, r.stdout.trim());
}

export function installPreCommitHook(repoPath = '.', mode: HookMode = 'check', args = '--no-rename'): { success: boolean; message: string } {
    const dir = hooksDir(repoPath);
    if (!dir) return { success: false, message: 'Not a git repository.' };
    mkdirSync(dir, { recursive: true });
    const hookPath = join(dir, 'pre-commit');
    if (existsSync(hookPath)) {
        const existing = readFileSync(hookPath, 'utf8');
        if (!existing.includes(MARKER)) {
            writeFileSync(`${hookPath}.prismify-backup`, existing);
        }
    }
    writeFileSync(hookPath, hookScript(mode, args));
    chmodSync(hookPath, 0o755);
    return { success: true, message: `Installed pre-commit hook (${mode} mode) at ${hookPath}` };
}

export function uninstallPreCommitHook(repoPath = '.'): { success: boolean; message: string } {
    const dir = hooksDir(repoPath);
    if (!dir) return { success: false, message: 'Not a git repository.' };
    const hookPath = join(dir, 'pre-commit');
    const backup = `${hookPath}.prismify-backup`;
    if (!existsSync(hookPath)) return { success: true, message: 'No pre-commit hook installed.' };
    if (!readFileSync(hookPath, 'utf8').includes(MARKER)) {
        return { success: false, message: 'The existing pre-commit hook was not installed by Prismify; left it alone.' };
    }
    if (existsSync(backup)) {
        writeFileSync(hookPath, readFileSync(backup, 'utf8'));
        unlinkSync(backup);
        return { success: true, message: 'Removed the Prismify hook and restored your previous hook.' };
    }
    unlinkSync(hookPath);
    return { success: true, message: 'Removed the Prismify pre-commit hook.' };
}
