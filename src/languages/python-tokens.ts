/**
 * A small Python tokenizer.
 *
 * It is not a full parser, but it reliably separates names, operators,
 * strings and comments, which is what renaming and whitespace formatting need.
 * Expressions inside f-string braces are tokenized too, so renames reach them.
 */

export type PyTokenType = 'name' | 'number' | 'string' | 'op' | 'comment' | 'newline';

export interface PyToken {
    type: PyTokenType;
    value: string;
    start: number;
    end: number;
    /** 1-indexed line of `start`. */
    line: number;
    /** Bracket depth before this token. */
    depth: number;
    /** Innermost open bracket before this token, if any. */
    bracket: '(' | '[' | '{' | null;
    /** Set on names that live inside an f-string replacement field. */
    inFString?: boolean;
    /** Set on names that directly follow `!` inside an f-string (conversion flags). */
    conversion?: boolean;
}

const OPERATORS = [
    '**=', '//=', '>>=', '<<=', '...', '->', ':=',
    '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '@=',
    '==', '!=', '<=', '>=', '**', '//', '<<', '>>',
    '+', '-', '*', '/', '%', '@', '&', '|', '^', '~', '<', '>',
    '(', ')', '[', ']', '{', '}', ',', ':', '.', ';', '=', '!',
];

const STRING_START = /^([rRbBuUfF]{0,2})('''|"""|'|")/;

export function tokenize(code: string): PyToken[] {
    const tokens: PyToken[] = [];
    const lineStarts = [0];
    for (let i = 0; i < code.length; i++) if (code[i] === '\n') lineStarts.push(i + 1);
    const lineOf = (pos: number) => {
        let lo = 0, hi = lineStarts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1;
        }
        return lo + 1;
    };
    const stack: Array<'(' | '[' | '{'> = [];

    scan(code, 0, code.length, tokens, stack, lineOf, false);
    return tokens;
}

function scan(
    code: string,
    from: number,
    to: number,
    tokens: PyToken[],
    stack: Array<'(' | '[' | '{'>,
    lineOf: (pos: number) => number,
    inFString: boolean
): void {
    let i = from;
    const push = (type: PyTokenType, start: number, end: number, extra: Partial<PyToken> = {}) => {
        tokens.push({
            type,
            value: code.slice(start, end),
            start,
            end,
            line: lineOf(start),
            depth: stack.length,
            bracket: stack[stack.length - 1] ?? null,
            ...(inFString ? { inFString: true } : {}),
            ...extra,
        });
    };

    while (i < to) {
        const ch = code[i];

        if (ch === '\n') {
            if (stack.length === 0 && !inFString) push('newline', i, i + 1);
            i++;
            continue;
        }
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f') {
            i++;
            continue;
        }
        if (ch === '\\' && code[i + 1] === '\n') {
            i += 2;
            continue;
        }
        if (ch === '#') {
            let j = i;
            while (j < to && code[j] !== '\n') j++;
            push('comment', i, j);
            i = j;
            continue;
        }

        const strMatch = STRING_START.exec(code.slice(i, Math.min(i + 6, to)));
        if (strMatch && (strMatch[1].length === 0 || !/[A-Za-z0-9_]/.test(code[i - 1] ?? ''))) {
            const prefix = strMatch[1];
            const quote = strMatch[2];
            const raw = /r/i.test(prefix);
            const isF = /f/i.test(prefix);
            const bodyStart = i + prefix.length + quote.length;
            const end = findStringEnd(code, bodyStart, quote, raw, isF, to);
            push('string', i, end);
            if (isF) scanFStringFields(code, bodyStart, end - quote.length, tokens, lineOf);
            i = end;
            continue;
        }

        if (/[A-Za-z_À-￿]/.test(ch)) {
            let j = i + 1;
            while (j < to && /[A-Za-z0-9_À-￿]/.test(code[j])) j++;
            push('name', i, j);
            i = j;
            continue;
        }

        if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(code[i + 1] ?? ''))) {
            let j = i + 1;
            while (j < to && /[0-9A-Za-z_.]/.test(code[j])) {
                if ((code[j] === 'e' || code[j] === 'E') && (code[j + 1] === '+' || code[j + 1] === '-')) j++;
                j++;
            }
            push('number', i, j);
            i = j;
            continue;
        }

        const op = OPERATORS.find(o => code.startsWith(o, i));
        if (op) {
            if (op === ')' || op === ']' || op === '}') stack.pop();
            push('op', i, i + op.length);
            if (op === '(' || op === '[' || op === '{') stack.push(op);
            i += op.length;
            continue;
        }

        // Unknown character: skip it.
        i++;
    }
}

function findStringEnd(code: string, i: number, quote: string, raw: boolean, isF: boolean, to: number): number {
    let depth = 0;
    while (i < to) {
        const ch = code[i];
        if (ch === '\\') {
            i += 2;
            continue;
        }
        if (isF && ch === '{') {
            if (code[i + 1] === '{' && depth === 0) {
                i += 2;
                continue;
            }
            depth++;
        } else if (isF && ch === '}' && depth > 0) {
            depth--;
        } else if (depth === 0 && code.startsWith(quote, i)) {
            return i + quote.length;
        } else if (quote.length === 1 && ch === '\n' && depth === 0) {
            return i; // unterminated single-line string
        }
        i++;
    }
    void raw;
    return to;
}

/** Tokenize the `{expr!r:spec}` fields of an f-string body. */
function scanFStringFields(code: string, from: number, to: number, tokens: PyToken[], lineOf: (pos: number) => number) {
    let i = from;
    while (i < to) {
        const ch = code[i];
        if (ch === '\\') {
            i += 2;
            continue;
        }
        if (ch === '{' && code[i + 1] === '{') {
            i += 2;
            continue;
        }
        if (ch !== '{') {
            i++;
            continue;
        }
        // Find the end of the expression part (before `!conv` or `:spec`) and the closing brace.
        let j = i + 1;
        let depth = 0;
        let exprEnd = -1;
        while (j < to) {
            const c = code[j];
            if (c === '\'' || c === '"') {
                const q = c;
                j++;
                while (j < to && code[j] !== q) j++;
            } else if ('([{'.includes(c)) depth++;
            else if (')]'.includes(c)) depth--;
            else if (c === '}' && depth === 0) break;
            else if (c === '}') depth--;
            else if (depth === 0 && exprEnd < 0 && c === '!' && code[j + 1] !== '=') exprEnd = j;
            else if (depth === 0 && exprEnd < 0 && c === ':') exprEnd = j;
            j++;
        }
        const close = j;
        const end = exprEnd >= 0 ? exprEnd : close;
        const local: Array<'(' | '[' | '{'> = [];
        scan(code, i + 1, end, tokens, local, lineOf, true);
        // Nested replacement fields inside the format spec, e.g. f"{x:{width}}".
        if (exprEnd >= 0) {
            const spec = code.slice(exprEnd, close);
            const nested = spec.indexOf('{');
            if (nested >= 0) scanFStringFields(code, exprEnd + nested, close, tokens, lineOf);
        }
        i = close + 1;
    }
}

export const PY_KEYWORDS = new Set([
    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
    'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
    'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);
