/**
 * Python plugin.
 *
 * Renames are limited to local variables inside a function and are done on
 * tokens, so strings, comments, attribute access (`obj.n`) and keyword
 * arguments (`f(n=1)`) are never touched. Parameters are left alone because
 * callers may pass them by keyword.
 *
 * Formatting uses `ruff format` or `black` when installed, otherwise a
 * conservative built-in formatter that only adjusts whitespace between tokens.
 * Output is checked with `python3 -m ast` when Python is available.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type {
    AppliedRename,
    DeadCode,
    FormatContext,
    FunctionInfo,
    Identifier,
    IdentifierHints,
    LanguagePlugin,
    MagicNumber,
    NamingSuggestion,
    NestedConditional,
    SkippedRename,
    SupportedLanguage,
} from '../types/index.js';
import { isValidIdentifier, toSnakeCase } from '../core/naming.js';
import { ABBREVIATIONS } from '../ai/heuristic.js';
import { PY_KEYWORDS, tokenize, type PyToken } from './python-tokens.js';

const LOOP_INDEX_NAMES = new Set(['i', 'j', 'k', 'n', 'm']);
const DYNAMIC_SCOPE = new Set(['locals', 'vars', 'eval', 'exec', 'globals']);
const GETTER = /^(get|fetch|load|read|find|create|make|build|compute|calc|calculate|parse|select|query|lookup)_([a-z][a-z0-9_]*)$/;

interface LogicalLine {
    start: number;
    end: number;
    line: number;
    indent: number;
    /** Index of the first token in `tokens`. */
    first: number;
    /** Index one past the last token. */
    last: number;
}

interface PyFunction {
    name: string;
    defToken: number;
    /** Offset where the def line (or its first decorator) starts. */
    start: number;
    /** Offset where the body ends. */
    end: number;
    line: number;
    indent: number;
    /** Index of the header-ending `:` token. */
    colon: number;
    /** Line of the header-ending colon. */
    headerEndLine: number;
    /** Indentation of the first body statement. */
    bodyIndent: number;
    /** Whether the body is on the same line as the header. */
    oneLiner: boolean;
    params: string[];
    isAsync: boolean;
}

interface Analysis {
    code: string;
    tokens: PyToken[];
    lines: LogicalLine[];
    functions: PyFunction[];
}

export class PythonPlugin implements LanguagePlugin {
    language: SupportedLanguage = 'python';
    extensions = ['.py', '.pyw', '.pyi'];
    canRename = true;

    // ── Analysis helpers ─────────────────────────────────────────────────

    private analyze(code: string): Analysis {
        const tokens = tokenize(code);
        const lines = logicalLines(code, tokens);
        const functions = findFunctions(code, tokens, lines);
        return { code, tokens, lines, functions };
    }

    private candidatesFor(a: Analysis, fn: PyFunction, minNameLength: number) {
        const { tokens } = a;
        const body = tokensIn(tokens, fn.colon + 1, fn.end);
        const locals = new Map<string, number>(); // name → token index of first binding
        const excluded = new Set<string>(fn.params);

        for (let k = 0; k < body.length; k++) {
            const idx = body[k];
            const tok = tokens[idx];
            if (tok.type !== 'name') continue;
            const prev = tokens[idx - 1];
            const next = tokens[idx + 1];

            if (DYNAMIC_SCOPE.has(tok.value) && next?.value === '(') return [];
            if (tok.value === 'global' || tok.value === 'nonlocal' || tok.value === 'import' || tok.value === 'from') {
                for (let j = idx + 1; j < tokens.length && tokens[j].type !== 'newline'; j++) {
                    if (tokens[j].type === 'name') excluded.add(tokens[j].value);
                }
            }
            if ((tok.value === 'def' || tok.value === 'class') && next?.type === 'name') {
                excluded.add(next.value);
                if (tok.value === 'def') {
                    // Nested function parameters.
                    for (let j = idx + 2; j < tokens.length && !(tokens[j].value === ':' && tokens[j].depth === tok.depth); j++) {
                        if (tokens[j].type === 'name') excluded.add(tokens[j].value);
                    }
                }
            }
            if (tok.value === 'lambda') {
                for (let j = idx + 1; j < tokens.length && !(tokens[j].value === ':' && tokens[j].depth === tok.depth); j++) {
                    if (tokens[j].type === 'name') excluded.add(tokens[j].value);
                }
            }
            if (PY_KEYWORDS.has(tok.value) || tok.inFString) continue;
            if (prev?.value === '.') continue;

            const bindsHere =
                (isStatementStart(tokens, idx) && isAssignmentTarget(tokens, idx)) ||
                (prev?.value === 'as') ||
                (next?.value === ':=') ||
                isForTarget(tokens, idx);
            if (bindsHere && !locals.has(tok.value)) locals.set(tok.value, idx);
        }

        const out: Array<{ name: string; tokenIndex: number }> = [];
        for (const [name, tokenIndex] of locals) {
            if (excluded.has(name)) continue;
            if (name.startsWith('_') || name === 'self' || name === 'cls') continue;
            if (minNameLength <= 1) continue; // profile opts out of renaming
            if (!(name.length < minNameLength || Object.prototype.hasOwnProperty.call(ABBREVIATIONS, name))) continue;
            if (LOOP_INDEX_NAMES.has(name) && isForTarget(tokens, tokenIndex)) continue;
            out.push({ name, tokenIndex });
        }
        return out;
    }

    private idFor(a: Analysis, tokenIndex: number): string {
        const tok = a.tokens[tokenIndex];
        const lineStart = a.code.lastIndexOf('\n', tok.start - 1) + 1;
        return `${tok.value}@${tok.line}:${tok.start - lineStart}`;
    }

    extractIdentifiers(code: string, opts: { minNameLength: number }): Identifier[] {
        const a = this.analyze(code);
        const out: Identifier[] = [];
        for (const fn of a.functions) {
            for (const c of this.candidatesFor(a, fn, opts.minNameLength)) {
                const tok = a.tokens[c.tokenIndex];
                const lineStart = code.lastIndexOf('\n', tok.start - 1) + 1;
                out.push({
                    id: this.idFor(a, c.tokenIndex),
                    name: c.name,
                    type: 'variable',
                    line: tok.line,
                    column: tok.start - lineStart,
                    context: code.slice(fn.start, Math.min(fn.end, fn.start + 1200)),
                    hints: pyHints(a, fn, c.name),
                });
            }
        }
        return out;
    }

    applyRenames(code: string, renames: NamingSuggestion[]) {
        const applied: AppliedRename[] = [];
        const skipped: SkippedRename[] = [];
        const a = this.analyze(code);
        const edits: Array<{ start: number; end: number; text: string }> = [];
        const claimed = new Map<PyFunction, Set<string>>();

        const all = a.functions.flatMap(fn =>
            this.candidatesFor(a, fn, Infinity).map(c => ({ fn, ...c, id: this.idFor(a, c.tokenIndex) }))
        );

        for (const s of renames) {
            const line = Number(s.id.split('@')[1]?.split(':')[0] ?? 0);
            const skip = (why: string) => skipped.push({ id: s.id, from: s.original, to: s.suggested, line, why });
            const cand = all.find(c => c.id === s.id);
            if (!cand) {
                skip('binding not found');
                continue;
            }
            const newName = s.suggested;
            if (!isValidIdentifier(newName, 'python')) {
                skip(`"${newName}" is not a safe identifier`);
                continue;
            }
            const { fn } = cand;
            const region = tokensIn(a.tokens, tokenIndexAt(a.tokens, fn.start), fn.end);
            const used = region.some(i => {
                const t = a.tokens[i];
                if (t.type !== 'name' || t.value !== newName || a.tokens[i - 1]?.value === '.') return false;
                return !isKeywordArgument(a.tokens, i);
            });
            const taken = claimed.get(fn) ?? new Set<string>();
            if (used || taken.has(newName)) {
                skip(`"${newName}" is already used in \`${fn.name}\``);
                continue;
            }
            const sites: Array<{ start: number; end: number; text: string }> = [];
            for (const i of tokensIn(a.tokens, fn.colon + 1, fn.end)) {
                const t = a.tokens[i];
                if (t.type !== 'name' || t.value !== cand.name) continue;
                const prev = a.tokens[i - 1];
                if (prev?.value === '.') continue;
                if (isKeywordArgument(a.tokens, i)) continue;
                sites.push({ start: t.start, end: t.end, text: newName });
            }
            if (sites.some(site => edits.some(e => e.start === site.start))) {
                skip('overlaps another rename');
                continue;
            }
            taken.add(newName);
            claimed.set(fn, taken);
            edits.push(...sites);
            applied.push({ id: s.id, from: cand.name, to: newName, line, reason: s.reason, confidence: s.confidence, source: s.source });
        }

        edits.sort((x, y) => y.start - x.start);
        let out = code;
        for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

        // Prove only names changed: token streams must match except for renamed names.
        if (applied.length > 0) {
            const pairs = new Set(applied.map(x => `${x.from}\u0000${x.to}`));
            const before = tokenize(code).filter(t => !t.inFString);
            const after = tokenize(out).filter(t => !t.inFString);
            const same = before.length === after.length && before.every((t, i) => {
                const u = after[i];
                if (t.type !== u.type) return false;
                if (t.value === u.value) return true;
                if (t.type === 'name') return pairs.has(`${t.value}\u0000${u.value}`);
                // f-strings change when a name inside them is renamed.
                return t.type === 'string' && /^[rRbBuU]*[fF]/.test(t.value);
            });
            if (!same) {
                return {
                    code,
                    applied: [],
                    skipped: skipped.concat(applied.map(x => ({ id: x.id, from: x.from, to: x.to, line: x.line, why: 'safety check failed; rename reverted' }))),
                };
            }
        }
        return { code: out, applied, skipped };
    }

    // ── Formatting & validation ──────────────────────────────────────────

    async format(code: string, ctx: FormatContext): Promise<string> {
        const lineLength = String(ctx.profile.maxLineLength);
        const hasProjectConfig = ctx.projectConfig && ctx.filePath && findUp(dirname(resolve(ctx.filePath)), ['pyproject.toml', 'ruff.toml', '.ruff.toml']);
        const stdinName = ctx.filePath || 'file.py';
        const cwd = ctx.filePath ? dirname(resolve(ctx.filePath)) : process.cwd();

        const formatter = detectPythonFormatter();
        if (formatter === 'ruff') {
            const args = ['format', '--stdin-filename', stdinName, ...(hasProjectConfig ? [] : ['--line-length', lineLength]), '-'];
            const r = spawnSync('ruff', args, { input: code, encoding: 'utf8', cwd });
            if (r.status === 0) return r.stdout;
        } else if (formatter === 'black') {
            const args = ['-q', '--stdin-filename', stdinName, ...(hasProjectConfig ? [] : ['--line-length', lineLength]), '-'];
            const r = spawnSync('black', args, { input: code, encoding: 'utf8', cwd });
            if (r.status === 0) return r.stdout;
        }
        return formatPythonBuiltin(code, ctx.profile.indentSize === 2 ? 2 : 4);
    }

    async validate(code: string) {
        const py = pythonExecutable();
        if (!py) return { valid: true, checked: false };
        const r = spawnSync(py, ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: code, encoding: 'utf8' });
        if (r.error) return { valid: true, checked: false };
        if (r.status === 0) return { valid: true, checked: true };
        const msg = (r.stderr || '').trim().split('\n').pop() || 'Syntax error';
        return { valid: false, checked: true, error: msg };
    }

    // ── Documentation ────────────────────────────────────────────────────

    extractFunctions(code: string): FunctionInfo[] {
        const a = this.analyze(code);
        return a.functions.map(fn => {
            const body = tokensIn(a.tokens, fn.colon + 1, fn.end);
            const firstBody = body.map(i => a.tokens[i]).find(t => t.type !== 'newline' && t.type !== 'comment');
            const hasDoc = !!firstBody && firstBody.type === 'string' && !/^[rRbBuU]*[fF]/.test(firstBody.value);
            const traits = new Set<string>();
            if (fn.isAsync) traits.add('async');
            let returnsValue = false;
            for (const i of body) {
                const t = a.tokens[i];
                const next = a.tokens[i + 1];
                if (t.value === 'raise') traits.add('throws');
                if (t.value === 'yield') traits.add('generator');
                if (t.value === 'print' && next?.value === '(') traits.add('logs');
                if (t.value === 'open' && next?.value === '(' && a.tokens[i - 1]?.value !== '.') traits.add('filesystem');
                if (/^(requests|httpx|aiohttp|urllib)$/.test(t.value)) traits.add('network');
                if (t.value === 'self' && next?.value === '.' && a.tokens[i + 3]?.value === '=' && isStatementStart(a.tokens, i)) traits.add('mutates-this');
                if (t.value === 'return' && next && next.type !== 'newline' && next.type !== 'comment') returnsValue = true;
            }
            return {
                id: `${fn.name}@${fn.line}`,
                name: fn.name,
                line: fn.line,
                params: fn.params.filter(p => p !== 'self' && p !== 'cls'),
                hasDoc,
                isAsync: fn.isAsync,
                returnsValue,
                body: code.slice(fn.start, Math.min(fn.end, fn.start + 1500)),
                traits: [...traits],
            };
        });
    }

    insertDocs(code: string, docs: Array<{ fn: FunctionInfo; text: string }>): string {
        const a = this.analyze(code);
        const lines = code.split('\n');
        const targets = docs
            .map(d => ({ d, fn: a.functions.find(f => `${f.name}@${f.line}` === d.fn.id) }))
            .filter((x): x is { d: { fn: FunctionInfo; text: string }; fn: PyFunction } => !!x.fn && !x.fn.oneLiner)
            .sort((x, y) => y.fn.headerEndLine - x.fn.headerEndLine);

        for (const { d, fn } of targets) {
            const indent = ' '.repeat(fn.bodyIndent);
            const text = d.text.replace(/"""/g, '\\"\\"\\"').split('\n');
            const doc = text.length === 1
                ? [`${indent}"""${text[0]}"""`]
                : [`${indent}"""${text[0]}`, '', ...text.slice(1).map(l => (l ? indent + l : '')), `${indent}"""`];
            lines.splice(fn.headerEndLine, 0, ...doc);
        }
        return lines.join('\n');
    }

    // ── Analysis ─────────────────────────────────────────────────────────

    findDeadCode(code: string): DeadCode[] {
        const a = this.analyze(code);
        const found: DeadCode[] = [];
        const isScript = /if\s+__name__\s*==/.test(code);
        for (let li = 0; li < a.lines.length; li++) {
            const ln = a.lines[li];
            const first = a.tokens[ln.first];
            if (!first) continue;
            if (['return', 'raise', 'break', 'continue'].includes(first.value)) {
                const dead: LogicalLine[] = [];
                for (let k = li + 1; k < a.lines.length && a.lines[k].indent >= ln.indent; k++) {
                    if (a.lines[k].indent === ln.indent) {
                        const f = a.tokens[a.lines[k].first];
                        if (f && ['elif', 'else', 'except', 'finally', 'case'].includes(f.value)) break;
                        if (f?.value === 'def' || f?.value === 'class' || f?.value === '@') break;
                    }
                    dead.push(a.lines[k]);
                }
                if (dead.length) {
                    const lastLine = code.slice(0, dead[dead.length - 1].end).split('\n').length;
                    found.push({ start: dead[0].line, end: lastLine, reason: `Unreachable code after \`${first.value}\`` });
                }
            }
            if (first.value === 'breakpoint' || (first.value === 'pdb' && a.tokens[ln.first + 2]?.value === 'set_trace')) {
                found.push({ start: ln.line, end: ln.line, reason: 'Debugger breakpoint' });
            }
            if (first.value === 'print' && a.tokens[ln.first + 1]?.value === '(' && !isScript) {
                found.push({ start: ln.line, end: ln.line, reason: 'Debug `print`' });
            }
        }
        return found;
    }

    detectMagicNumbers(code: string): MagicNumber[] {
        const a = this.analyze(code);
        const srcLines = code.split('\n');
        const out: MagicNumber[] = [];
        const cmp = new Set(['<', '<=', '>', '>=', '==', '!=']);
        const arith = new Set(['+', '-', '*', '/', '//', '%', '**', '+=', '-=', '*=', '/=']);
        a.tokens.forEach((tok, i) => {
            if (tok.type !== 'number' || tok.inFString) return;
            let value = Number(tok.value.replace(/_/g, ''));
            if (!Number.isFinite(value)) return;
            const prev = a.tokens[i - 1];
            const prev2 = a.tokens[i - 2];
            const negative = prev?.value === '-' && (!prev2 || prev2.type === 'op' || PY_KEYWORDS.has(prev2.value)) && prev2?.value !== ')' && prev2?.value !== ']';
            if (negative) value = -value;
            const before = negative ? prev2 : prev;
            const beforeIdx = negative ? i - 2 : i - 1;
            const next = a.tokens[i + 1];
            if ([-1, 0, 1, 2].includes(value)) return;
            if (before?.value === '=' && (before.depth === 0 || before.bracket === '(')) return; // assignment or keyword argument
            if (before?.value === ':' && before.bracket === '{') return; // dict value
            if (before?.value === '[' && next?.value === ']') return; // index
            const enclosingCall = a.tokens.slice(0, i).reverse().find(t => t.value === '(' && t.depth === tok.depth - 1);
            const callIdx = enclosingCall ? a.tokens.indexOf(enclosingCall) : -1;
            const callee = callIdx > 0 ? a.tokens[callIdx - 1] : undefined;
            if (callee?.type === 'name' && ['range', 'round', 'pow', 'zfill', 'ljust', 'rjust', 'int', 'split', 'rsplit'].includes(callee.value)) return;

            const info: MagicNumber = {
                value,
                raw: (negative ? '-' : '') + tok.value,
                line: tok.line,
                column: tok.start - (code.lastIndexOf('\n', tok.start - 1) + 1),
                lineText: srcLines[tok.line - 1]?.trim() ?? '',
            };
            if ((before && cmp.has(before.value)) || (next && cmp.has(next.value))) {
                info.usage = 'compare';
                const other = before && cmp.has(before.value) ? a.tokens[beforeIdx - 1] : a.tokens[i + 2];
                if (other?.type === 'name') info.hint = other.value;
                else if (other?.value === ']' && a.tokens[beforeIdx - 2]?.type === 'string') info.hint = a.tokens[beforeIdx - 2].value.replace(/['"]/g, '');
                if (info.hint && /status|code/i.test(info.hint)) info.usage = 'status';
            } else if ((before && arith.has(before.value)) || (next && arith.has(next.value))) {
                if (Math.abs(value) <= 10 && Number.isInteger(value)) return;
                info.usage = 'arithmetic';
                info.operator = before && arith.has(before.value) ? before.value : next?.value;
                const other = before && arith.has(before.value) ? a.tokens[beforeIdx - 1] : a.tokens[i + 2];
                if (other?.type === 'name') info.hint = other.value;
            } else if (callee?.type === 'name') {
                info.usage = /^(sleep|wait|after|delay)$/.test(callee.value) ? 'timer' : 'argument';
                info.hint = callee.value;
            } else {
                if (Math.abs(value) <= 10) return;
                info.usage = 'other';
            }
            out.push(info);
        });
        return out;
    }

    detectNestedConditionals(code: string, maxDepth: number): NestedConditional[] {
        const a = this.analyze(code);
        const results: NestedConditional[] = [];
        const lines = a.lines.filter(l => a.tokens[l.first]?.type !== 'comment');
        const firstWord = (l: LogicalLine) => a.tokens[l.first]?.value;
        const text = (l: LogicalLine) => code.slice(a.tokens[l.first].start, l.end).trim();

        // Children of a block header = following lines with greater indent, up to the first dedent.
        const childrenOf = (idx: number): number[] => {
            const kids: number[] = [];
            const base = lines[idx].indent;
            let childIndent = -1;
            for (let k = idx + 1; k < lines.length && lines[k].indent > base; k++) {
                if (childIndent < 0) childIndent = lines[k].indent;
                if (lines[k].indent === childIndent) kids.push(k);
            }
            return kids;
        };
        const siblingsAfter = (idx: number): number[] => {
            const out: number[] = [];
            const base = lines[idx].indent;
            for (let k = idx + 1; k < lines.length && lines[k].indent >= base; k++) {
                if (lines[k].indent === base) out.push(k);
            }
            return out;
        };
        const parentOf = (idx: number): number => {
            for (let k = idx - 1; k >= 0; k--) if (lines[k].indent < lines[idx].indent) return k;
            return -1;
        };

        for (let i = 0; i < lines.length; i++) {
            if (firstWord(lines[i]) !== 'if') continue;
            // Build the chain of conditional ancestors (if / elif / else blocks).
            const chain = [i];
            let p = parentOf(i);
            while (p >= 0 && ['if', 'elif', 'else'].includes(firstWord(lines[p]) ?? '')) {
                chain.unshift(p);
                p = parentOf(p);
            }
            if (chain.length <= maxDepth) continue;
            // Keep only the deepest chain per root.
            const root = chain[0];
            const existing = results.findIndex(r => r.startLine === lines[root].line);
            if (existing >= 0 && results[existing].depth >= chain.length) continue;

            const pure = chain.every((idx, n) => {
                if (firstWord(lines[idx]) !== 'if') return false;
                const sib = siblingsAfter(idx)[0];
                if (sib !== undefined && ['elif', 'else'].includes(firstWord(lines[sib]) ?? '')) return false;
                if (n === chain.length - 1) return true;
                const kids = childrenOf(idx);
                return kids.length === 1 && kids[0] === chain[n + 1];
            });
            const parent = parentOf(root);
            const inFunction = parent >= 0 && ['def', 'async'].includes(firstWord(lines[parent]) ?? '');
            const rest = siblingsAfter(root);
            let tail: NestedConditional['tail'] = 'other';
            let tailReturn: string | undefined;
            if (inFunction) {
                if (rest.length === 0) tail = 'empty';
                else if (rest.length === 1 && firstWord(lines[rest[0]]) === 'return' && childrenOf(rest[0]).length === 0) {
                    tail = 'return';
                    tailReturn = text(lines[rest[0]]);
                }
            }
            const innermost = chain[chain.length - 1];
            const kids = childrenOf(innermost);
            const bodyStart = kids.length ? lines[kids[0]] : null;
            const bodyEndLine = (() => {
                let k = innermost + 1;
                while (k < lines.length && lines[k].indent > lines[innermost].indent) k++;
                return k - 1;
            })();
            const body = bodyStart
                ? dedent(code.slice(code.lastIndexOf('\n', bodyStart.start - 1) + 1, lines[bodyEndLine].end))
                : '';
            const conditions = chain.map(idx => text(lines[idx]).replace(/^if\s+/, '').replace(/:\s*(#.*)?$/, '').trim());
            const entry: NestedConditional = {
                depth: chain.length,
                startLine: lines[root].line,
                endLine: code.slice(0, lines[bodyEndLine].end).split('\n').length,
                conditions,
                body,
                pure,
                guardable: pure && inFunction && tail !== 'other',
                tail,
                tailReturn,
            };
            if (existing >= 0) results[existing] = entry;
            else results.push(entry);
        }
        return results;
    }
}

// ── Structure ────────────────────────────────────────────────────────────

function logicalLines(code: string, tokens: PyToken[]): LogicalLine[] {
    const out: LogicalLine[] = [];
    let first = 0;
    for (let i = 0; i <= tokens.length; i++) {
        const tok = tokens[i];
        if (i === tokens.length || tok.type === 'newline') {
            if (i > first) {
                const startTok = tokens[first];
                const lineStart = code.lastIndexOf('\n', startTok.start - 1) + 1;
                out.push({
                    start: startTok.start,
                    end: i < tokens.length ? tok.start : tokens[i - 1].end,
                    line: startTok.line,
                    indent: expandIndent(code.slice(lineStart, startTok.start)),
                    first,
                    last: i,
                });
            }
            first = i + 1;
        }
    }
    return out;
}

function expandIndent(ws: string): number {
    let n = 0;
    for (const ch of ws) n = ch === '\t' ? n + 8 - (n % 8) : n + 1;
    return n;
}

function findFunctions(code: string, tokens: PyToken[], lines: LogicalLine[]): PyFunction[] {
    const out: PyFunction[] = [];
    for (let li = 0; li < lines.length; li++) {
        const ln = lines[li];
        let k = ln.first;
        let isAsync = false;
        if (tokens[k]?.value === 'async') {
            isAsync = true;
            k++;
        }
        if (tokens[k]?.value !== 'def' || tokens[k + 1]?.type !== 'name') continue;
        const name = tokens[k + 1].value;
        // Header: params up to the closing paren, then `:` at depth 0.
        const params: string[] = [];
        let colon = -1;
        for (let j = k + 2; j < ln.last; j++) {
            const t = tokens[j];
            if (t.depth === 1 && t.type === 'name' && ['(', ',', '*', '**'].includes(tokens[j - 1]?.value ?? '')) params.push(t.value);
            if (t.value === ':' && t.depth === 0) {
                colon = j;
                break;
            }
        }
        if (colon < 0) continue;
        const oneLiner = colon + 1 < ln.last && tokens[colon + 1].type !== 'comment';
        let endLine = li;
        if (!oneLiner) {
            for (let m = li + 1; m < lines.length; m++) {
                const firstTok = tokens[lines[m].first];
                if (firstTok.type === 'comment' && lines[m].indent <= ln.indent) continue;
                if (lines[m].indent <= ln.indent) break;
                endLine = m;
            }
        }
        // Include decorators above the def.
        let startLine = li;
        while (startLine > 0 && tokens[lines[startLine - 1].first]?.value === '@' && lines[startLine - 1].indent === ln.indent) startLine--;
        const startTok = tokens[lines[startLine].first];
        const bodyLine = !oneLiner && endLine > li ? lines[li + 1] : null;
        out.push({
            name,
            defToken: k,
            start: code.lastIndexOf('\n', startTok.start - 1) + 1,
            end: lines[endLine].end,
            line: tokens[k].line,
            indent: ln.indent,
            colon,
            headerEndLine: tokens[colon].line,
            bodyIndent: bodyLine ? bodyLine.indent : ln.indent + 4,
            oneLiner,
            params,
            isAsync,
        });
    }
    return out;
}

function tokensIn(tokens: PyToken[], fromIndex: number, endOffset: number): number[] {
    const out: number[] = [];
    for (let i = fromIndex; i < tokens.length && tokens[i].start < endOffset; i++) out.push(i);
    return out;
}

function tokenIndexAt(tokens: PyToken[], offset: number): number {
    const i = tokens.findIndex(t => t.start >= offset);
    return i < 0 ? tokens.length : i;
}

/** `name` in `f(name=…)` — a keyword argument, not a variable. */
function isKeywordArgument(tokens: PyToken[], idx: number): boolean {
    const prev = tokens[idx - 1];
    const next = tokens[idx + 1];
    return next?.value === '=' && tokens[idx].bracket === '(' && (prev?.value === '(' || prev?.value === ',');
}

function isStatementStart(tokens: PyToken[], idx: number): boolean {
    const prev = tokens[idx - 1];
    if (!prev) return true;
    if (prev.type === 'newline' || prev.value === ';') return true;
    // `if x: y = 1` style one-liners.
    return prev.value === ':' && prev.depth === 0 && tokens[idx].depth === 0;
}

/** `a = …`, `a: int = …`, `a += …`, or `a, b = …` where idx is one of the targets. */
function isAssignmentTarget(tokens: PyToken[], idx: number): boolean {
    const assign = /^(=|\+=|-=|\*=|\/=|\/\/=|%=|\*\*=|&=|\|=|\^=|>>=|<<=|@=)$/;
    for (let j = idx + 1; j < tokens.length; j++) {
        const t = tokens[j];
        if (t.type === 'newline') return false;
        if (t.depth === 0 && assign.test(t.value)) return true;
        if (t.depth === 0 && t.value === ':') {
            // Annotated assignment.
            for (let m = j + 1; m < tokens.length && tokens[m].type !== 'newline'; m++) if (tokens[m].value === '=' && tokens[m].depth === 0) return true;
            return false;
        }
        if (!(t.type === 'name' || [',', '(', ')', '[', ']', '*'].includes(t.value))) return false;
        if (t.type === 'name' && PY_KEYWORDS.has(t.value)) return false;
    }
    return false;
}

function isForTarget(tokens: PyToken[], idx: number): boolean {
    const isTargetPart = (t: PyToken) =>
        [',', '(', ')', '[', ']'].includes(t.value) || (t.type === 'name' && !PY_KEYWORDS.has(t.value));
    let j = idx - 1;
    while (j >= 0 && isTargetPart(tokens[j])) j--;
    if (j < 0 || tokens[j].value !== 'for') return false;
    const forDepth = tokens[j].depth;
    for (let m = idx + 1; m < tokens.length; m++) {
        if (tokens[m].value === 'in' && tokens[m].depth === forDepth) return true;
        if (!isTargetPart(tokens[m])) return false;
    }
    return false;
}

function pyHints(a: Analysis, fn: PyFunction, name: string): IdentifierHints {
    const hints: IdentifierHints = {};
    const { tokens, code } = a;
    const body = tokensIn(tokens, fn.colon + 1, fn.end);
    const occ = body.filter(i => tokens[i].type === 'name' && tokens[i].value === name && tokens[i - 1]?.value !== '.');
    const props = new Set<string>();
    let augmentedOnes = 0;
    let augmentedOther = 0;
    let appended = false;
    let initial: string | undefined;

    for (const i of occ) {
        const next = tokens[i + 1];
        if (next?.value === '.' && tokens[i + 2]?.type === 'name') {
            props.add(tokens[i + 2].value);
            if (tokens[i + 2].value === 'append' || tokens[i + 2].value === 'extend') appended = true;
        }
        if (next?.value === '+=') {
            if (tokens[i + 2]?.value === '1' && tokens[i + 3]?.type === 'newline') augmentedOnes++;
            else augmentedOther++;
        }
        if (isStatementStart(tokens, i) && next?.value === '=' && initial === undefined) {
            const lineEnd = tokens.findIndex((t, k) => k > i && t.type === 'newline');
            initial = code.slice(tokens[i + 2]?.start ?? 0, lineEnd > 0 ? tokens[lineEnd].start : fn.end).trim();
        }
        if (tokens[i - 1]?.value === 'as') {
            const stmt = [...tokens.slice(0, i)].reverse().find(t => t.type === 'name' && ['except', 'with', 'import', 'from'].includes(t.value));
            if (stmt?.value === 'except') hints.role = 'error';
        }
        if (isForTarget(tokens, i)) {
            let m = i + 1;
            while (m < tokens.length && tokens[m].value !== 'in') m++;
            const coll: string[] = [];
            for (let q = m + 1; q < tokens.length && !['newline'].includes(tokens[q].type) && ![':', 'if', ']', ')', '}'].includes(tokens[q].value); q++) {
                coll.push(tokens[q].value);
            }
            const simple = coll.join('');
            if (/^[A-Za-z_][\w.]*$/.test(simple)) hints.iterates = simple.split('.').pop();
        }
    }
    if (props.size) hints.usedProperties = [...props].slice(0, 8);

    if (initial !== undefined) {
        const attr = initial.match(/^(?:await\s+)?[A-Za-z_][\w.]*\.([A-Za-z_]\w*)$/);
        const key = initial.match(/^[A-Za-z_][\w.]*\[\s*['"]([A-Za-z_][\w]*)['"]\s*\]$/) ?? initial.match(/^[A-Za-z_][\w.]*\.get\(\s*['"]([A-Za-z_][\w]*)['"]/);
        const call = initial.match(/^(?:await\s+)?(?:[A-Za-z_]\w*\.)*([A-Za-z_]\w*)\(/);
        if (attr) hints.initFrom = toSnakeCase(attr[1]);
        else if (key) hints.initFrom = toSnakeCase(key[1]);
        else if (call) {
            const getter = call[1].match(GETTER);
            if (call[1] === 'read' || /\bopen\(.*\)\.read\(/.test(initial)) hints.initFrom = 'contents';
            else if (getter) hints.initFrom = getter[2];
            else if (/^[A-Z]/.test(call[1])) hints.initFrom = toSnakeCase(call[1]);
        }
        if (initial === '0' || initial === '0.0') {
            if (augmentedOther > 0) hints.role = 'accumulator';
            else if (augmentedOnes > 0) hints.role = 'counter';
        } else if ((initial === "''" || initial === '""') && augmentedOther > 0) {
            hints.role = 'text';
        } else if (initial === '[]' && appended) {
            hints.role = 'items';
        }
    }
    if (!hints.role && occ.length === 2 && tokens[occ[1] - 1]?.value === 'return' && tokens[occ[1] + 1]?.type === 'newline') {
        hints.role = 'result';
    }
    return hints;
}

function dedent(text: string): string {
    const lines = text.split('\n');
    const indents = lines.filter(l => l.trim()).map(l => l.match(/^\s*/)![0].length);
    const min = indents.length ? Math.min(...indents) : 0;
    return lines.map(l => l.slice(min)).join('\n');
}

function findUp(dir: string, names: string[]): string | null {
    let cur = dir;
    for (;;) {
        for (const n of names) if (existsSync(join(cur, n))) return join(cur, n);
        const parent = dirname(cur);
        if (parent === cur) return null;
        cur = parent;
    }
}

// ── External tools ───────────────────────────────────────────────────────

let formatterCache: 'ruff' | 'black' | 'builtin' | undefined;
let pythonCache: string | null | undefined;

function commandWorks(cmd: string, args: string[]): boolean {
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    return !r.error && r.status === 0;
}

export function detectPythonFormatter(): 'ruff' | 'black' | 'builtin' {
    if (formatterCache) return formatterCache;
    const pref = process.env.PRISMIFY_PYTHON_FORMATTER;
    if (pref === 'builtin') return (formatterCache = 'builtin');
    if (pref !== 'black' && commandWorks('ruff', ['--version'])) return (formatterCache = 'ruff');
    if (commandWorks('black', ['--version'])) return (formatterCache = 'black');
    return (formatterCache = 'builtin');
}

export function pythonExecutable(): string | null {
    if (pythonCache !== undefined) return pythonCache;
    for (const cmd of [process.env.PRISMIFY_PYTHON, 'python3', 'python'].filter(Boolean) as string[]) {
        if (commandWorks(cmd, ['--version'])) return (pythonCache = cmd);
    }
    return (pythonCache = null);
}

/** Reset cached tool detection (for tests). */
export function resetPythonToolCache() {
    formatterCache = undefined;
    pythonCache = undefined;
}

// ── Built-in formatter ───────────────────────────────────────────────────

const SPACED_OPS = new Set([
    '==', '!=', '<', '>', '<=', '>=', '->', ':=',
    '+=', '-=', '*=', '/=', '//=', '%=', '**=', '&=', '|=', '^=', '>>=', '<<=', '@=',
    'and', 'or', 'in', 'is', 'not',
]);
const BINARY_OPS = new Set(['+', '-', '*', '/', '//', '%', '@', '&', '|', '^', '<<', '>>']);
const KEYWORDS_BEFORE_PAREN = new Set(['if', 'elif', 'while', 'for', 'in', 'not', 'and', 'or', 'return', 'assert', 'with', 'yield', 'except', 'del', 'is', 'await', 'raise', 'lambda']);

/**
 * Whitespace-only formatter: never changes tokens, only inserts single spaces
 * between tokens on the same line, converts tab indentation, trims trailing
 * whitespace and normalises blank lines. Multi-line strings are left as-is.
 */
export function formatPythonBuiltin(code: string, indentSize: 2 | 4 = 4): string {
    const tokens = tokenize(code).filter(t => !t.inFString);
    const inserts: number[] = [];

    const isOperand = (t: PyToken | undefined) =>
        !!t && ((t.type === 'name' && !PY_KEYWORDS.has(t.value)) || t.type === 'number' || t.type === 'string' || [')', ']', '}'].includes(t.value) || ['None', 'True', 'False'].includes(t.value));

    for (let i = 0; i < tokens.length - 1; i++) {
        const a = tokens[i];
        const b = tokens[i + 1];
        if (a.type === 'newline' || b.type === 'newline' || b.type === 'comment') continue;
        if (a.line !== b.line || a.end !== b.start) continue; // only fill empty gaps on one line

        let space = false;
        if (a.value === ',' && ![')', ']', '}'].includes(b.value)) space = true;
        if (SPACED_OPS.has(a.value) && a.type === 'op') space = true;
        if (SPACED_OPS.has(b.value) && b.type === 'op') space = true;
        if (a.value === '=' && (a.depth === 0)) space = true;
        if (b.value === '=' && (b.depth === 0)) space = true;
        if (a.value === ':' && a.bracket !== '[' && b.value !== '=') space = true;
        if (BINARY_OPS.has(b.value) && isOperand(a)) space = true;
        if (BINARY_OPS.has(a.value) && isOperand(tokens[i - 1])) space = true;
        if (a.type === 'name' && KEYWORDS_BEFORE_PAREN.has(a.value) && ['(', '[', '{'].includes(b.value)) space = true;
        if (a.value === ')' && b.type === 'name' && PY_KEYWORDS.has(b.value)) space = true;
        if (space) inserts.push(b.start);
    }

    let out = code;
    for (const pos of inserts.sort((x, y) => y - x)) out = out.slice(0, pos) + ' ' + out.slice(pos);

    // Line-level cleanups, skipping lines inside multi-line strings.
    const protectedLines = new Set<number>();
    for (const t of tokenize(out)) {
        if (t.type === 'string' && t.value.includes('\n')) {
            const startLine = t.line;
            const endLine = startLine + (t.value.match(/\n/g)?.length ?? 0);
            for (let l = startLine + 1; l <= endLine; l++) protectedLines.add(l);
        }
    }
    const lines = out.split('\n');
    const result: string[] = [];
    let blank = 0;
    lines.forEach((line, idx) => {
        const lineNo = idx + 1;
        if (protectedLines.has(lineNo)) {
            result.push(line);
            blank = 0;
            return;
        }
        let l = line.replace(/[ \t]+$/, '');
        const lead = l.match(/^[ \t]*/)![0];
        if (lead.includes('\t')) {
            const width = expandIndent(lead);
            l = ' '.repeat(Math.round((width / 8) * indentSize)) + l.slice(lead.length);
        }
        if (l === '') {
            blank++;
            if (blank > 2) return;
        } else {
            blank = 0;
        }
        result.push(l);
    });
    while (result.length && result[result.length - 1] === '') result.pop();
    return ensureTopLevelSpacing(result.join('\n') + '\n');
}

/** PEP 8: two blank lines around top-level functions and classes. */
function ensureTopLevelSpacing(code: string): string {
    const lines = code.split('\n');
    const protectedLines = new Set<number>();
    for (const t of tokenize(code)) {
        if (t.type === 'string' && t.value.includes('\n')) {
            const end = t.line + (t.value.match(/\n/g)?.length ?? 0);
            for (let l = t.line + 1; l <= end; l++) protectedLines.add(l - 1);
        }
    }
    const isTopLevelDef = (i: number) => !protectedLines.has(i) && /^(async\s+def|def|class|@)\b|^@/.test(lines[i]);
    const out: string[] = [];
    let seenCode = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isTopLevelDef(i) && seenCode && !(i > 0 && /^@/.test(lines[i - 1]))) {
            // Keep comments that sit directly above the definition attached to it.
            let attach = out.length;
            while (attach > 0 && /^#/.test(out[attach - 1])) attach--;
            let blanks = 0;
            while (attach - blanks - 1 >= 0 && out[attach - blanks - 1] === '') blanks++;
            if (attach - blanks > 0 && blanks < 2) out.splice(attach, 0, ...Array(2 - blanks).fill(''));
        }
        out.push(line);
        if (line.trim() && !/^#/.test(line) && !protectedLines.has(i)) seenCode = true;
    }
    return out.join('\n');
}
