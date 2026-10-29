/**
 * Diff rendering.
 */

import { createTwoFilesPatch, structuredPatch } from 'diff';
import chalk from 'chalk';

export interface DiffStats {
    additions: number;
    deletions: number;
}

/** Unified diff text (for --json and patches). */
export function unifiedDiff(original: string, updated: string, file: string): string {
    return createTwoFilesPatch(`a/${file}`, `b/${file}`, original, updated, '', '', { context: 3 });
}

export function diffStats(original: string, updated: string): DiffStats {
    const patch = structuredPatch('a', 'b', original, updated, '', '', { context: 0 });
    let additions = 0;
    let deletions = 0;
    for (const h of patch.hunks) {
        for (const l of h.lines) {
            if (l.startsWith('+')) additions++;
            else if (l.startsWith('-')) deletions++;
        }
    }
    return { additions, deletions };
}

/** Colored, line-numbered hunks for the terminal. */
export function renderDiff(original: string, updated: string, context = 2): string {
    const patch = structuredPatch('a', 'b', original, updated, '', '', { context });
    const width = String(Math.max(original.split('\n').length, updated.split('\n').length)).length;
    const out: string[] = [];
    const gutter = (n: number | '') => chalk.dim(String(n).padStart(width) + ' │');

    patch.hunks.forEach((h, idx) => {
        if (idx > 0) out.push(chalk.dim(' '.repeat(width) + ' ┆'));
        let oldLine = h.oldStart;
        let newLine = h.newStart;
        for (const raw of h.lines) {
            if (raw.startsWith('\\')) continue; // "No newline at end of file"
            const sign = raw[0];
            const text = raw.slice(1);
            if (sign === '-') {
                out.push(`${gutter(oldLine++)} ${chalk.red('- ' + text)}`);
            } else if (sign === '+') {
                out.push(`${gutter(newLine++)} ${chalk.green('+ ' + text)}`);
            } else {
                out.push(`${gutter(newLine)} ${chalk.dim('  ' + text)}`);
                oldLine++;
                newLine++;
            }
        }
    });
    return out.join('\n');
}
