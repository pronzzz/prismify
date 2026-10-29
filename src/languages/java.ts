/**
 * Java plugin.
 *
 * Formatting and syntax checking use prettier-plugin-java (a real Java parser).
 * Renaming is not offered for Java: without full type and scope analysis a
 * rename could silently change which field or overload is used.
 * Analysis runs on a copy of the source with strings and comments blanked out,
 * so literals and comments never produce false matches.
 */

import * as prettier from 'prettier';
import * as javaPluginNs from 'prettier-plugin-java';
import type {
    DeadCode,
    FormatContext,
    FunctionInfo,
    Identifier,
    LanguagePlugin,
    MagicNumber,
    NamingSuggestion,
    NestedConditional,
    SupportedLanguage,
} from '../types/index.js';
import { insertBlockComments } from './javascript.js';

const javaPlugin: prettier.Plugin = ((javaPluginNs as any).default ?? javaPluginNs) as prettier.Plugin;

const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'return', 'new', 'else', 'do', 'try', 'throw']);

export class JavaPlugin implements LanguagePlugin {
    language: SupportedLanguage = 'java';
    extensions = ['.java'];
    canRename = false;

    extractIdentifiers(_code: string): Identifier[] {
        return [];
    }

    applyRenames(code: string, renames: NamingSuggestion[]) {
        return {
            code,
            applied: [],
            skipped: renames.map(r => ({ id: r.id, from: r.original, to: r.suggested, line: 0, why: 'renaming is not supported for Java' })),
        };
    }

    async format(code: string, ctx: FormatContext): Promise<string> {
        const p = ctx.profile;
        let options: prettier.Options = {
            tabWidth: p.indentSize === 2 ? 2 : 4,
            useTabs: p.indentStyle === 'tabs',
            printWidth: p.maxLineLength,
        };
        if (ctx.projectConfig && ctx.filePath) {
            const project = await prettier.resolveConfig(ctx.filePath).catch(() => null);
            if (project) options = { ...options, ...project };
        }
        return prettier.format(code, { ...options, parser: 'java', plugins: [javaPlugin] });
    }

    async validate(code: string) {
        try {
            await prettier.format(code, { parser: 'java', plugins: [javaPlugin] });
            return { valid: true, checked: true };
        } catch (error: any) {
            return { valid: false, checked: true, error: String(error.message ?? error).split('\n')[0] };
        }
    }

    extractFunctions(code: string): FunctionInfo[] {
        const masked = maskJava(code);
        const lines = code.split('\n');
        const maskedLines = masked.split('\n');
        const classNames = new Set([...masked.matchAll(/\b(?:class|record|enum)\s+([A-Z]\w*)/g)].map(m => m[1]));
        const out: FunctionInfo[] = [];

        const sig = /^\s*((?:@\w+(?:\([^)]*\))?\s+)*)((?:(?:public|private|protected|static|final|abstract|synchronized|native|default)\s+)*)(?:<[^>]+>\s*)?(?:([\w<>[\],.?\s]+?)\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+?)?\s*(\{.*)?$/;

        for (let i = 0; i < maskedLines.length; i++) {
            const m = maskedLines[i].match(sig);
            if (!m) continue;
            const [, , , returnType, name, paramsText] = m;
            if (CONTROL.has(name)) continue;
            const isCtor = !returnType && classNames.has(name);
            if (!returnType && !isCtor) continue;
            if (returnType && /^(return|new|else|throw)$/.test(returnType.trim())) continue;
            // Must open a body on this or the next line.
            const opens = /\)\s*(throws\s+[\w.,\s]+?)?\s*\{/.test(maskedLines[i]) || maskedLines[i + 1]?.trim().startsWith('{');
            if (!opens) continue;

            const start = offsetOfLine(code, i);
            const bodyEnd = matchBrace(masked, masked.indexOf('{', start));
            const body = code.slice(start, bodyEnd + 1);
            const params = paramsText.split(',').map(p => p.trim()).filter(Boolean).map(p => p.split(/\s+/).pop()!.replace(/[^\w]/g, ''));

            let above = i - 1;
            while (above >= 0 && /^\s*@/.test(lines[above])) above--;
            const prevLine = lines[above]?.trim() ?? '';
            const hasDoc = prevLine.endsWith('*/') || prevLine.startsWith('//');
            const maskedBody = masked.slice(start, bodyEnd + 1);
            const traits: string[] = [];
            if (/\bthrow\b|\bthrows\b/.test(maskedBody)) traits.push('throws');
            if (/System\.(out|err)\.|\blog(ger)?\.(info|debug|warn|error)/.test(maskedBody)) traits.push('logs');
            if (/\bthis\.\w+\s*=[^=]/.test(maskedBody)) traits.push('mutates-this');
            if (/HttpClient|HttpURLConnection|RestTemplate|WebClient/.test(maskedBody)) traits.push('network');

            // Insert docs above annotations.
            let anchor = i;
            while (anchor > 0 && /^\s*@/.test(lines[anchor - 1])) anchor--;
            out.push({
                id: `${name}@${anchor + 1}`,
                name: isCtor ? 'constructor' : name,
                line: anchor + 1,
                params,
                hasDoc,
                isAsync: false,
                returnsValue: !isCtor && returnType?.trim() !== 'void',
                body: body.slice(0, 1500),
                traits,
            });
        }
        return out;
    }

    insertDocs(code: string, docs: Array<{ fn: FunctionInfo; text: string }>): string {
        return insertBlockComments(code, docs);
    }

    findDeadCode(code: string): DeadCode[] {
        const masked = maskJava(code);
        const out: DeadCode[] = [];
        masked.split('\n').forEach((line, i) => {
            if (/System\.(out|err)\.print(ln|f)?\s*\(/.test(line)) out.push({ start: i + 1, end: i + 1, reason: 'Debug `System.out` print' });
            if (/\bprintStackTrace\s*\(\s*\)/.test(line)) out.push({ start: i + 1, end: i + 1, reason: '`printStackTrace()` call' });
        });
        return out;
    }

    detectMagicNumbers(code: string): MagicNumber[] {
        const masked = maskJava(code);
        const lines = code.split('\n');
        const out: MagicNumber[] = [];
        masked.split('\n').forEach((line, i) => {
            if (/\bfinal\b/.test(line)) return;
            const re = /(?<![\w.])(-?\d+(?:\.\d+)?)[fFdDlL]?(?![\w.])/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(line))) {
                const value = Number(m[1]);
                if ([-1, 0, 1, 2].includes(value)) continue;
                const before = line.slice(0, m.index).trimEnd();
                const after = line.slice(m.index + m[0].length).trimStart();
                if (/[[]$/.test(before) && after.startsWith(']')) continue;
                if (/\b\w+\s*=$/.test(before) && /^;/.test(after) && !/[<>!=]=$/.test(before)) continue; // int x = 5;
                const info: MagicNumber = { value, raw: m[0], line: i + 1, column: m.index, lineText: lines[i].trim() };
                const cmpBefore = before.match(/([\w.()]+)\s*(<=|>=|==|!=|<|>)$/);
                const cmpAfter = after.match(/^(<=|>=|==|!=|<|>)\s*([\w.()]+)/);
                if (cmpBefore || cmpAfter) {
                    info.usage = 'compare';
                    const other = cmpBefore ? cmpBefore[1] : cmpAfter![2];
                    info.hint = other.replace(/\(\)$/, '').split('.').pop()?.replace(/^(get|is)(?=[A-Z])/, '');
                    if (info.hint && /status|code/i.test(info.hint)) info.usage = 'status';
                } else if (/[-+*/%]$/.test(before) || /^[-+*/%]/.test(after)) {
                    if (Math.abs(value) <= 10 && Number.isInteger(value)) continue;
                    info.usage = 'arithmetic';
                    info.operator = (before.match(/([-+*/%])=?$/) ?? after.match(/^([-+*/%])/))?.[1];
                    info.hint = (before.match(/(\w+)\s*[-+*/%]=?$/) ?? after.match(/^[-+*/%]\s*(\w+)/))?.[1];
                } else {
                    if (Math.abs(value) <= 10) continue;
                    info.usage = /sleep|schedule|timeout/i.test(line) ? 'timer' : 'argument';
                }
                out.push(info);
            }
        });
        return out;
    }

    detectNestedConditionals(code: string, maxDepth: number): NestedConditional[] {
        const masked = maskJava(code);
        type Block = { kind: 'if' | 'else' | 'method' | 'other'; open: number; cond?: string; ifStart?: number };
        const stack: Block[] = [];
        const deepest = new Map<number, Block[]>();
        const ifHeader = /\bif\s*\(/y;

        for (let i = 0; i < masked.length; i++) {
            const ch = masked[i];
            ifHeader.lastIndex = i;
            if (ch === 'i' && !/\w/.test(masked[i - 1] ?? '') && ifHeader.test(masked)) {
                const parenOpen = masked.indexOf('(', i);
                const parenClose = matchParen(masked, parenOpen);
                let j = parenClose + 1;
                while (/\s/.test(masked[j] ?? '')) j++;
                if (masked[j] === '{') {
                    const block: Block = { kind: 'if', open: j, cond: code.slice(parenOpen + 1, parenClose).trim(), ifStart: i };
                    stack.push(block);
                    const chain = stack.filter(b => b.kind === 'if' || b.kind === 'else');
                    if (chain.length > maxDepth) {
                        const root = chain[0].ifStart ?? chain[0].open;
                        const prev = deepest.get(root);
                        if (!prev || chain.length > prev.length) deepest.set(root, [...chain]);
                    }
                    i = j;
                    continue;
                }
                i = parenClose;
                continue;
            }
            if (ch === '{') {
                const before = masked.slice(0, i).trimEnd();
                let kind: Block['kind'] = 'other';
                if (/\belse$/.test(before)) kind = 'else';
                else if (/\)\s*(throws\s+[\w.,\s]+)?$/.test(before)) {
                    const open = matchParenBack(masked, before.lastIndexOf(')'));
                    const head = masked.slice(0, open).trimEnd().match(/(\w+)$/)?.[1];
                    if (head && !CONTROL.has(head)) kind = 'method';
                }
                stack.push({ kind, open: i });
            } else if (ch === '}') {
                stack.pop();
            }
        }

        const lineAt = (pos: number) => code.slice(0, pos).split('\n').length;
        const out: NestedConditional[] = [];
        for (const chain of deepest.values()) {
            const innermost = chain[chain.length - 1];
            const innerClose = matchBrace(masked, innermost.open);
            const root = chain[0];
            const rootClose = matchBrace(masked, root.open);
            const pure = chain.every((b, n) => {
                if (b.kind !== 'if') return false;
                const close = matchBrace(masked, b.open);
                if (/^\s*else\b/.test(masked.slice(close + 1))) return false;
                if (n === chain.length - 1) return true;
                const inner = masked.slice(b.open + 1, close).trim();
                const next = chain[n + 1];
                const nextText = masked.slice(next.ifStart!, matchBrace(masked, next.open) + 1).trim();
                return inner === nextText;
            });
            const enclosing = (() => {
                const s: number[] = [];
                for (let k = 0; k < (root.ifStart ?? root.open); k++) {
                    if (masked[k] === '{') s.push(k);
                    else if (masked[k] === '}') s.pop();
                }
                return s[s.length - 1];
            })();
            const enclosingHead = enclosing !== undefined ? masked.slice(0, enclosing).trimEnd() : '';
            const inMethod = /\)\s*(throws\s+[\w.,\s]+)?$/.test(enclosingHead) && !/\b(if|for|while|switch|catch)\s*\([^)]*\)\s*$/.test(enclosingHead);
            const after = masked.slice(rootClose + 1);
            let tail: NestedConditional['tail'] = 'other';
            let tailReturn: string | undefined;
            if (inMethod) {
                if (/^\s*\}/.test(after)) tail = 'empty';
                const ret = after.match(/^\s*(return\b[^;]*;)\s*\}/);
                if (ret) {
                    tail = 'return';
                    const start = rootClose + 1 + after.indexOf('return');
                    tailReturn = code.slice(start, start + ret[1].length);
                }
            }
            out.push({
                depth: chain.length,
                startLine: lineAt(root.ifStart ?? root.open),
                endLine: lineAt(rootClose),
                conditions: chain.map(b => b.cond ?? ''),
                body: dedent(code.slice(innermost.open + 1, innerClose)).trim(),
                pure,
                guardable: pure && inMethod && tail !== 'other',
                tail,
                tailReturn,
            });
        }
        return out.sort((a, b) => a.startLine - b.startLine);
    }
}

/** Replace the contents of strings, chars and comments with spaces (newlines kept). */
export function maskJava(code: string): string {
    let out = '';
    let i = 0;
    while (i < code.length) {
        const ch = code[i];
        if (ch === '/' && code[i + 1] === '/') {
            const end = code.indexOf('\n', i);
            const stop = end < 0 ? code.length : end;
            out += ' '.repeat(stop - i);
            i = stop;
        } else if (ch === '/' && code[i + 1] === '*') {
            const end = code.indexOf('*/', i + 2);
            const stop = end < 0 ? code.length : end + 2;
            out += code.slice(i, stop).replace(/[^\n]/g, ' ');
            i = stop;
        } else if (code.startsWith('"""', i)) {
            const end = code.indexOf('"""', i + 3);
            const stop = end < 0 ? code.length : end + 3;
            out += '"' + code.slice(i + 1, stop - 1).replace(/[^\n]/g, ' ') + '"';
            i = stop;
        } else if (ch === '"' || ch === '\'') {
            let j = i + 1;
            while (j < code.length && code[j] !== ch && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1;
            out += ch + ' '.repeat(Math.max(0, j - i - 1)) + (code[j] === ch ? ch : '');
            i = code[j] === ch ? j + 1 : j;
        } else {
            out += ch;
            i++;
        }
    }
    return out;
}

function matchBrace(masked: string, open: number): number {
    let depth = 0;
    for (let i = open; i < masked.length; i++) {
        if (masked[i] === '{') depth++;
        else if (masked[i] === '}' && --depth === 0) return i;
    }
    return masked.length - 1;
}

function matchParen(masked: string, open: number): number {
    let depth = 0;
    for (let i = open; i < masked.length; i++) {
        if (masked[i] === '(') depth++;
        else if (masked[i] === ')' && --depth === 0) return i;
    }
    return masked.length - 1;
}

function matchParenBack(masked: string, close: number): number {
    let depth = 0;
    for (let i = close; i >= 0; i--) {
        if (masked[i] === ')') depth++;
        else if (masked[i] === '(' && --depth === 0) return i;
    }
    return 0;
}

function offsetOfLine(code: string, lineIndex: number): number {
    let pos = 0;
    for (let i = 0; i < lineIndex; i++) pos = code.indexOf('\n', pos) + 1;
    return pos;
}

function dedent(text: string): string {
    const lines = text.replace(/^\n+/, '').split('\n');
    const indents = lines.filter(l => l.trim()).map(l => l.match(/^\s*/)![0].length);
    const min = indents.length ? Math.min(...indents) : 0;
    return lines.map(l => l.slice(min)).join('\n');
}
