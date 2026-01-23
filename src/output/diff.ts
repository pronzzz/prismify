/**
 * Diff Preview Generator
 * 
 * Creates side-by-side and unified diff views of code changes.
 */

import { diffLines, createTwoFilesPatch } from 'diff';
import chalk from 'chalk';
import type { CodeChange } from '../types/index.js';

export interface DiffResult {
    /** Unified diff format */
    unified: string;

    /** Colored terminal output */
    terminal: string;

    /** Summary of changes */
    summary: {
        additions: number;
        deletions: number;
        modifications: number;
    };
}

/**
 * Generate a diff between original and beautified code
 */
export function generateDiff(
    original: string,
    beautified: string,
    filename: string = 'code'
): DiffResult {
    // Generate unified diff
    const unified = createTwoFilesPatch(
        `${filename} (original)`,
        `${filename} (beautified)`,
        original,
        beautified,
        '',
        '',
        { context: 3 }
    );

    // Generate line-by-line diff for terminal
    const lineDiff = diffLines(original, beautified);

    let additions = 0;
    let deletions = 0;

    const terminalLines: string[] = [
        chalk.bold.cyan(`\n━━━ Diff Preview: ${filename} ━━━\n`),
    ];

    for (const part of lineDiff) {
        const lines = part.value.split('\n').filter(l => l !== '' || part.value === '\n');

        for (const line of lines) {
            if (part.added) {
                additions++;
                terminalLines.push(chalk.green(`+ ${line}`));
            } else if (part.removed) {
                deletions++;
                terminalLines.push(chalk.red(`- ${line}`));
            } else {
                terminalLines.push(chalk.gray(`  ${line}`));
            }
        }
    }

    terminalLines.push('');
    terminalLines.push(chalk.bold(
        `Summary: ${chalk.green(`+${additions}`)} additions, ${chalk.red(`-${deletions}`)} deletions`
    ));

    return {
        unified,
        terminal: terminalLines.join('\n'),
        summary: {
            additions,
            deletions,
            modifications: Math.min(additions, deletions),
        },
    };
}

/**
 * Format changes as a readable list
 */
export function formatChangeList(changes: CodeChange[]): string {
    if (changes.length === 0) {
        return chalk.yellow('No changes made.');
    }

    const lines: string[] = [
        chalk.bold.cyan('\n━━━ Changes Made ━━━\n'),
    ];

    for (let i = 0; i < changes.length; i++) {
        const change = changes[i];
        const confidence = Math.round(change.confidence * 100);
        const confidenceColor = confidence >= 80 ? chalk.green : confidence >= 60 ? chalk.yellow : chalk.red;

        lines.push(`${chalk.bold(`${i + 1}.`)} ${chalk.blue(change.type)} at line ${change.line}`);
        lines.push(`   ${chalk.red(change.original)} → ${chalk.green(change.replacement)}`);
        lines.push(`   ${chalk.gray(change.explanation)}`);
        lines.push(`   Confidence: ${confidenceColor(`${confidence}%`)}`);
        lines.push('');
    }

    return lines.join('\n');
}
