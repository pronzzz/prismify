/**
 * Naming helpers shared by the AI providers and language plugins.
 */

import type { IdentifierKind, SupportedLanguage } from '../types/index.js';

const JS_RESERVED = new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
    'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if',
    'import', 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw',
    'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static',
    'implements', 'interface', 'package', 'private', 'protected', 'public', 'await', 'async',
    'arguments', 'eval', 'undefined', 'NaN', 'Infinity', 'module',
    // Type names: legal identifiers, but `string`/`number` make poor variable names.
    'any', 'never', 'unknown', 'object', 'string', 'number', 'boolean', 'symbol', 'bigint',
    // Globals whose shadowing would break or confuse code.
    'window', 'document', 'console', 'process', 'require', 'exports', 'global', 'globalThis',
    'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'Map', 'Set', 'Promise',
    'JSON', 'Math', 'Date', 'Error', 'RegExp',
]);

const PY_RESERVED = new Set([
    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class',
    'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global',
    'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
    'try', 'while', 'with', 'yield', 'match', 'case', 'type', '_',
    // Builtins that should not be shadowed.
    'abs', 'all', 'any', 'bin', 'bool', 'bytes', 'callable', 'chr', 'dict', 'dir', 'divmod',
    'enumerate', 'eval', 'exec', 'filter', 'float', 'format', 'frozenset', 'getattr', 'hash',
    'hex', 'id', 'input', 'int', 'isinstance', 'iter', 'len', 'list', 'locals', 'map', 'max',
    'min', 'next', 'object', 'oct', 'open', 'ord', 'pow', 'print', 'range', 'repr', 'reversed',
    'round', 'set', 'slice', 'sorted', 'str', 'sum', 'super', 'tuple', 'vars', 'zip', 'file',
    'self', 'cls',
]);

const JAVA_RESERVED = new Set([
    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
    'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally',
    'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface',
    'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short',
    'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
    'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null', 'var', 'record',
    'yield', 'sealed', 'permits',
]);

export function isReserved(name: string, language: SupportedLanguage): boolean {
    if (language === 'python') return PY_RESERVED.has(name);
    if (language === 'java') return JAVA_RESERVED.has(name);
    return JS_RESERVED.has(name);
}

/** Split any identifier style into lowercase words. */
export function splitWords(name: string): string[] {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
}

export function toCamelCase(name: string): string {
    const words = splitWords(name);
    return words.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join('');
}

export function toPascalCase(name: string): string {
    return splitWords(name).map(w => w[0].toUpperCase() + w.slice(1)).join('');
}

export function toSnakeCase(name: string): string {
    return splitWords(name).join('_');
}

export function toScreamingSnake(name: string): string {
    return splitWords(name).join('_').toUpperCase();
}

/** Convert a name to the convention used by `language` for `kind`. */
export function conventionalName(name: string, kind: IdentifierKind, language: SupportedLanguage): string {
    if (kind === 'class') return toPascalCase(name);
    if (language === 'python') return toSnakeCase(name);
    return toCamelCase(name);
}

/** Is `name` a syntactically valid identifier we are willing to introduce? */
export function isValidIdentifier(name: string, language: SupportedLanguage): boolean {
    if (name.length < 2 || name.length > 40) return false;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
    if (isReserved(name, language)) return false;
    return true;
}

/** Very small English singularizer for collection names (`users` → `user`). */
export function singularize(word: string): string | null {
    const w = word.toLowerCase();
    if (w.length < 3) return null;
    if (/(ss|us|is)$/.test(w)) return null;
    if (w.endsWith('ies') && w.length > 4) return word.slice(0, -3) + 'y';
    if (/(ches|shes|xes|zes|ses)$/.test(w)) return word.slice(0, -2);
    if (w.endsWith('s')) return word.slice(0, -1);
    if (w.endsWith('list') && w.length > 4) return word.slice(0, -4) || null;
    return null;
}

/** Name for an element of a collection called `collection`. */
export function elementNameFor(collection: string): string {
    const words = splitWords(collection);
    const last = words[words.length - 1] ?? '';
    if (['arr', 'array', 'list', 'items', 'values', 'data', 'xs', 'elements', 'entries'].includes(last)) {
        return last === 'entries' ? 'entry' : last === 'values' ? 'value' : 'item';
    }
    const single = singularize(last);
    if (!single) return 'item';
    words[words.length - 1] = single;
    return words.join('_');
}
