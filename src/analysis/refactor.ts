/**
 * Refactoring analysis: magic numbers and deep nesting.
 *
 * Suggestions are reported with ready-to-use code; they are never applied
 * automatically, because both changes are judgement calls.
 */

import type {
    LanguagePlugin,
    MagicNumber,
    NestedConditional,
    RefactorOptions,
    RefactorSuggestion,
    SupportedLanguage,
} from '../types/index.js';
import { DEFAULT_REFACTOR_OPTIONS } from '../types/refactor.js';
import { toScreamingSnake } from '../core/naming.js';

const TIME_CONSTANTS: Record<number, string> = {
    60000: 'ONE_MINUTE_MS',
    3600000: 'ONE_HOUR_MS',
    86400000: 'ONE_DAY_MS',
    604800000: 'ONE_WEEK_MS',
};

const HTTP_STATUS: Record<number, string> = {
    200: 'HTTP_OK', 201: 'HTTP_CREATED', 202: 'HTTP_ACCEPTED', 204: 'HTTP_NO_CONTENT',
    301: 'HTTP_MOVED_PERMANENTLY', 302: 'HTTP_FOUND', 304: 'HTTP_NOT_MODIFIED',
    400: 'HTTP_BAD_REQUEST', 401: 'HTTP_UNAUTHORIZED', 403: 'HTTP_FORBIDDEN', 404: 'HTTP_NOT_FOUND',
    409: 'HTTP_CONFLICT', 422: 'HTTP_UNPROCESSABLE_ENTITY', 429: 'HTTP_TOO_MANY_REQUESTS',
    500: 'HTTP_INTERNAL_SERVER_ERROR', 502: 'HTTP_BAD_GATEWAY', 503: 'HTTP_SERVICE_UNAVAILABLE',
};

export function analyzeForRefactoring(
    code: string,
    plugin: LanguagePlugin,
    options: RefactorOptions = {}
): RefactorSuggestion[] {
    const opts = { ...DEFAULT_REFACTOR_OPTIONS, ...options };
    const out: RefactorSuggestion[] = [];
    if (opts.namedConstants) out.push(...constantSuggestions(plugin.detectMagicNumbers(code), plugin.language));
    if (opts.simplifyConditionals) {
        out.push(...plugin.detectNestedConditionals(code, opts.maxNestingDepth).map(n => nestingSuggestion(n, plugin.language)));
    }
    return out.sort((a, b) => a.lineRange[0] - b.lineRange[0]);
}

// ── Magic numbers ────────────────────────────────────────────────────────

/** Suggest a constant name for a magic number. Returns [name, confidence]. */
export function constantName(m: MagicNumber): [string, number] {
    if (TIME_CONSTANTS[m.value]) return [TIME_CONSTANTS[m.value], 0.85];
    if (m.value === 1000 && m.usage === 'timer') return ['ONE_SECOND_MS', 0.8];
    if (m.usage === 'status' && HTTP_STATUS[m.value]) return [HTTP_STATUS[m.value], 0.85];
    const hint = m.hint ? toScreamingSnake(m.hint) : '';
    if (m.usage === 'timer') return [hint && !/^(SET_TIMEOUT|SET_INTERVAL|SLEEP)$/.test(hint) ? `${hint}_DELAY_MS` : 'DELAY_MS', 0.7];
    if (m.usage === 'compare' && hint) return [`${hint}_THRESHOLD`, 0.7];
    if (m.usage === 'arithmetic' && hint) {
        const op = m.operator ?? '';
        if (/^[*/]/.test(op)) return [`${hint}_${Math.abs(m.value) < 1 ? 'RATE' : 'MULTIPLIER'}`, 0.65];
        if (/^[-+]/.test(op)) return [`${hint}_ADJUSTMENT`, 0.6];
        return [`${hint}_FACTOR`, 0.6];
    }
    if (m.usage === 'argument' && hint) return [`${hint}_VALUE`, 0.55];
    return [`VALUE_${m.raw.replace(/^-/, 'MINUS_').replace(/\./g, '_')}`, 0.5];
}

function declaration(name: string, raw: string, language: SupportedLanguage): string {
    if (language === 'python') return `${name} = ${raw}`;
    if (language === 'java') {
        const type = /[.eE]/.test(raw) ? 'double' : Math.abs(Number(raw)) > 2147483647 ? 'long' : 'int';
        return `private static final ${type} ${name} = ${raw}${type === 'long' ? 'L' : ''};`;
    }
    return `const ${name} = ${raw};`;
}

function constantSuggestions(found: MagicNumber[], language: SupportedLanguage): RefactorSuggestion[] {
    const byValue = new Map<number, MagicNumber[]>();
    for (const m of found) byValue.set(m.value, [...(byValue.get(m.value) ?? []), m]);

    const usedNames = new Set<string>();
    const out: RefactorSuggestion[] = [];
    for (const [value, uses] of byValue) {
        let [name, confidence] = constantName(uses.find(u => u.hint) ?? uses[0]);
        if (usedNames.has(name)) name = `${name}_${String(Math.abs(value)).replace('.', '_')}`;
        usedNames.add(name);
        const lines = [...new Set(uses.map(u => u.line))];
        const first = uses[0];
        out.push({
            type: 'magic-constant',
            title: `Name the magic number ${first.raw}`,
            explanation:
                `${first.raw} appears on line${lines.length > 1 ? 's' : ''} ${lines.join(', ')} with no explanation. ` +
                `Declaring it once as \`${name}\` documents its meaning and keeps every use in sync.`,
            original: first.lineText,
            refactored: `${declaration(name, first.raw, language)}\n${first.lineText.replace(new RegExp(`(?<![\\w.])${escapeRegex(first.raw)}(?![\\w.])`), name)}`,
            confidence,
            lineRange: [lines[0], lines[lines.length - 1]],
        });
    }
    return out;
}

// ── Nesting ──────────────────────────────────────────────────────────────

const INVERT: Record<string, string> = {
    '===': '!==', '!==': '===', '==': '!=', '!=': '==',
    '<': '>=', '>=': '<', '>': '<=', '<=': '>',
};

/** Negate a condition as readably as possible. */
export function negate(cond: string, language: SupportedLanguage): string {
    const c = cond.trim();
    if (language === 'python') {
        if (/^not\s+/.test(c) && !/\b(and|or)\b/.test(c)) return c.replace(/^not\s+/, '');
        const cmp = singleComparison(c, ['==', '!=', '<=', '>=', '<', '>']);
        if (cmp && !/\b(and|or|if|else|not|in|is)\b/.test(c)) return `${cmp.left} ${INVERT[cmp.op]} ${cmp.right}`;
        if (/^[\w.]+(\(.*\))?$/.test(c)) return `not ${c}`;
        return `not (${c})`;
    }
    if (/^![\w.$]+(\([^()]*\))?$/.test(c)) return c.slice(1);
    const cmp = singleComparison(c, ['===', '!==', '==', '!=', '<=', '>=', '<', '>']);
    if (cmp && !/&&|\|\||\?/.test(c)) return `${cmp.left} ${INVERT[cmp.op]} ${cmp.right}`;
    if (/^[\w.$]+(\(.*\))?$/.test(c) && !/\(.*\).*\(/.test(c)) return `!${c}`;
    return `!(${c})`;
}

function singleComparison(c: string, ops: string[]): { left: string; op: string; right: string } | null {
    let depth = 0;
    let found: { left: string; op: string; right: string } | null = null;
    for (let i = 0; i < c.length; i++) {
        const ch = c[i];
        if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) depth--;
        else if (ch === '"' || ch === "'" || ch === '`') return null;
        else if (depth === 0) {
            const op = ops.find(o => c.startsWith(o, i) && !'=!<>'.includes(c[i + o.length]) && !'=!<>'.includes(c[i - 1] ?? ''));
            if (op) {
                if (found) return null; // more than one comparison
                found = { left: c.slice(0, i).trim(), op, right: c.slice(i + op.length).trim() };
                i += op.length - 1;
            }
        }
    }
    return found && found.left && found.right ? found : null;
}

function nestingSuggestion(n: NestedConditional, language: SupportedLanguage): RefactorSuggestion {
    const py = language === 'python';
    const ret = n.tail === 'return' && n.tailReturn ? n.tailReturn.replace(/;$/, '') : 'return';
    let refactored: string;
    let explanation: string;
    let confidence: number;
    let title: string;

    if (n.guardable) {
        const guards = n.conditions.map(c => (py ? `if ${negate(c, language)}:\n    ${ret}` : `if (${negate(c, language)}) ${ret};`));
        // The last top-level statement of the (dedented) body: does it already leave the function?
        const topLevel = n.body.split('\n').filter(l => /^\S/.test(l) && !/^[}\])]/.test(l));
        const bodyEndsWithReturn = /^(return|throw|raise)\b/.test(topLevel[topLevel.length - 1] ?? '');
        const trailing = n.tail === 'return' && !bodyEndsWithReturn ? [py ? ret : `${ret};`] : [];
        refactored = [...guards, '', n.body, ...trailing].join('\n');
        title = `Flatten ${n.depth} nested ifs with guard clauses`;
        explanation = `These ${n.depth} nested conditions can exit early instead, so the main logic is no longer indented ${n.depth} levels deep. Behaviour is unchanged.`;
        confidence = 0.85;
    } else if (n.conditions.length > 1 && n.pure) {
        const joined = n.conditions.map(c => (/\|\||\bor\b|\?/.test(c) ? `(${c})` : c)).join(py ? ' and ' : ' && ');
        const indent = py ? '    ' : '  ';
        const body = n.body.split('\n').map(l => (l ? indent + l : l)).join('\n');
        refactored = py ? `if ${joined}:\n${body}` : `if (${joined}) {\n${body}\n}`;
        title = `Combine ${n.depth} nested ifs into one condition`;
        explanation = `None of these ifs has an else branch, so they can be merged into a single condition. Behaviour is unchanged.`;
        confidence = 0.8;
    } else {
        refactored = '';
        title = `Reduce ${n.depth}-level nesting`;
        explanation = `Conditionals nest ${n.depth} levels deep here. Consider extracting the inner block into a well-named helper, or handling the failure cases first and returning early.`;
        confidence = 0.6;
    }

    return {
        type: 'simplify-conditional',
        title,
        explanation,
        original: n.conditions.map((c, i) => `${'  '.repeat(i)}${py ? `if ${c}:` : `if (${c}) {`}`).join('\n'),
        refactored,
        confidence,
        lineRange: [n.startLine, n.endLine],
    };
}

function escapeRegex(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
