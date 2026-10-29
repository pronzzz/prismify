/**
 * Human-readable reporting for the CLI.
 */

import chalk from 'chalk';
import type { BeautifyResult, RefactorSuggestion } from '../types/index.js';
import { diffStats, renderDiff } from './diff.js';

export interface ReportOptions {
    showDiff: boolean;
    verbose: boolean;
    /** Label of the AI provider in use. */
    providerLabel?: string;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** One-line status for a file. */
export function statusLine(r: BeautifyResult, name: string, mode: 'write' | 'check' | 'preview'): string {
    if (r.error) return `${chalk.red('✖')} ${name} ${chalk.red(r.error)}`;
    if (!r.changed) return `${chalk.green('✔')} ${name} ${chalk.dim('already clean')}`;
    const parts: string[] = [];
    if (r.renames.length) parts.push(`${r.renames.length} rename${r.renames.length > 1 ? 's' : ''}`);
    if (r.docs.length) parts.push(`${r.docs.length} doc comment${r.docs.length > 1 ? 's' : ''}`);
    if (r.changes.some(c => c.type === 'format')) parts.push('formatting');
    const { additions, deletions } = diffStats(r.original, r.beautified);
    const verb = mode === 'write' ? chalk.cyan('updated') : chalk.yellow('would change');
    return `${chalk.yellow('✎')} ${name} ${verb} ${chalk.dim(`(${parts.join(', ')}; ${chalk.green(`+${additions}`)} ${chalk.red(`-${deletions}`)})`)}`;
}

export function fileReport(r: BeautifyResult, name: string, mode: 'write' | 'check' | 'preview', opts: ReportOptions): string {
    const out: string[] = [];
    out.push(chalk.bold(`\n${name}`) + chalk.dim(`  ${r.language} · ${r.processingTime}ms`));
    if (r.error) {
        out.push(`  ${chalk.red('✖')} ${r.error}`);
        return out.join('\n');
    }

    if (opts.showDiff && r.changed) {
        out.push('');
        out.push(indent(renderDiff(r.original, r.beautified), 2));
    }

    if (r.renames.length) {
        out.push('');
        out.push(chalk.bold.cyan('  Renamed'));
        const w = Math.max(...r.renames.map(x => `${x.from} → ${x.to}`.length));
        const lw = Math.max(...r.renames.map(x => String(x.line).length));
        for (const x of r.renames) {
            const label = `${chalk.red(x.from)} ${chalk.dim('→')} ${chalk.green(x.to)}`;
            const pad = ' '.repeat(Math.max(1, w - `${x.from} → ${x.to}`.length + 2));
            const src = x.source === 'ai' ? chalk.magenta('ai') : chalk.blue('rule');
            out.push(`    ${label}${pad}${chalk.dim(`line ${String(x.line).padEnd(lw)}`)}  ${src} ${chalk.dim(`${pct(x.confidence)} · ${x.reason}`)}`);
        }
    }
    if (opts.verbose && r.skippedRenames.length) {
        out.push('');
        out.push(chalk.bold.dim('  Not renamed'));
        for (const s of r.skippedRenames) {
            out.push(chalk.dim(`    ${s.from} → ${s.to}  line ${s.line}: ${s.why}`));
        }
    }

    if (r.docs.length) {
        out.push('');
        out.push(chalk.bold.cyan('  Documented'));
        const dw = Math.max(...r.docs.map(d => d.target.length));
        const dlw = Math.max(...r.docs.map(d => String(d.line).length));
        for (const d of r.docs) {
            const first = d.text.split('\n')[0];
            out.push(`    ${chalk.green(d.target.padEnd(dw))} ${chalk.dim(`line ${String(d.line).padEnd(dlw)}`)}  ${chalk.dim(first)}`);
        }
    }

    if (r.suggestions.length) {
        out.push('');
        out.push(chalk.bold.cyan(`  Suggestions`) + chalk.dim(' (not applied)'));
        r.suggestions.forEach((s, i) => out.push(suggestionBlock(s, i + 1, opts.verbose)));
    }

    if (r.deadCode.length) {
        out.push('');
        out.push(chalk.bold.cyan('  Dead or debug code'));
        for (const d of r.deadCode) {
            const range = d.start === d.end ? `line ${d.start}` : `lines ${d.start}–${d.end}`;
            out.push(`    ${chalk.yellow('•')} ${chalk.dim(range.padEnd(12))} ${d.reason}`);
        }
    }

    for (const w of r.warnings) out.push(`  ${chalk.yellow('⚠')} ${chalk.yellow(w)}`);

    if (!r.changed && !r.suggestions.length && !r.deadCode.length) {
        out.push(`  ${chalk.green('✔')} already clean`);
    }
    return out.join('\n');
}

function suggestionBlock(s: RefactorSuggestion, n: number, verbose: boolean): string {
    const range = s.lineRange[0] === s.lineRange[1] ? `line ${s.lineRange[0]}` : `lines ${s.lineRange[0]}–${s.lineRange[1]}`;
    const lines = [`    ${chalk.bold(`${n}.`)} ${s.title} ${chalk.dim(`· ${range} · ${pct(s.confidence)}`)}`];
    lines.push(chalk.dim(wrap(s.explanation, 76, '       ')));
    if (s.refactored && (verbose || s.type === 'simplify-conditional' || s.refactored.split('\n').length <= 4)) {
        const code = s.refactored.split('\n').slice(0, verbose ? 40 : 12);
        lines.push(code.map(l => `       ${chalk.green('│')} ${chalk.green(l)}`).join('\n'));
        if (!verbose && s.refactored.split('\n').length > 12) lines.push(chalk.dim('       │ … (use --verbose for the full suggestion)'));
    }
    return lines.join('\n');
}

function wrap(text: string, width: number, prefix: string): string {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
        if ((cur + ' ' + w).trim().length > width) {
            lines.push(cur.trim());
            cur = w;
        } else {
            cur += ' ' + w;
        }
    }
    if (cur.trim()) lines.push(cur.trim());
    return lines.map(l => prefix + l).join('\n');
}

function indent(text: string, n: number): string {
    const pad = ' '.repeat(n);
    return text.split('\n').map(l => pad + l).join('\n');
}

export function summaryLine(results: BeautifyResult[], mode: 'write' | 'check' | 'preview', ms: number): string {
    const changed = results.filter(r => r.changed && !r.error).length;
    const errors = results.filter(r => r.error).length;
    const clean = results.length - changed - errors;
    const parts = [
        `${results.length} file${results.length === 1 ? '' : 's'}`,
        changed ? chalk.yellow(`${changed} ${mode === 'write' ? 'updated' : 'to change'}`) : null,
        clean ? chalk.green(`${clean} clean`) : null,
        errors ? chalk.red(`${errors} failed`) : null,
    ];
    const hints = results.reduce((n, r) => n + r.suggestions.length + r.deadCode.length, 0);
    if (hints) parts.push(chalk.cyan(`${hints} suggestion${hints === 1 ? '' : 's'}`));
    return `${parts.filter(Boolean).join(chalk.dim(' · '))} ${chalk.dim(`in ${ms}ms`)}`;
}
