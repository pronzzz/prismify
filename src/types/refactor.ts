/**
 * Types for refactoring analysis. Suggestions are reported, never auto-applied.
 */

export type RefactorType = 'simplify-conditional' | 'magic-constant';

export interface RefactorSuggestion {
    type: RefactorType;
    /** Short title, e.g. "Extract 18 into MIN_AGE". */
    title: string;
    explanation: string;
    /** Code before (excerpt). */
    original: string;
    /** Suggested code. */
    refactored: string;
    /** 0–1. */
    confidence: number;
    /** 1-indexed inclusive line range. */
    lineRange: [number, number];
}

export interface RefactorOptions {
    simplifyConditionals?: boolean;
    namedConstants?: boolean;
    /** Nesting depth above which a conditional is reported. Default 3. */
    maxNestingDepth?: number;
}

export const DEFAULT_REFACTOR_OPTIONS: Required<RefactorOptions> = {
    simplifyConditionals: true,
    namedConstants: true,
    maxNestingDepth: 3,
};

/** A numeric literal that probably deserves a name. */
export interface MagicNumber {
    value: number;
    /** Source text of the literal. */
    raw: string;
    line: number;
    column: number;
    /** Source line it appears on. */
    lineText: string;
    /** A name hint from the surrounding code (e.g. the compared property). */
    hint?: string;
    /** What the literal is used for. */
    usage?: 'compare' | 'timer' | 'status' | 'arithmetic' | 'argument' | 'other';
    /** Operator next to the literal, for arithmetic usage (`*`, `+=`, …). */
    operator?: string;
}

/** A chain of nested `if` statements. */
export interface NestedConditional {
    depth: number;
    startLine: number;
    endLine: number;
    /** Conditions from outermost to innermost (source text). */
    conditions: string[];
    /** Body of the innermost `if` (source text). */
    body: string;
    /** Each if contains only the next one and none has an else branch (so conditions can be combined). */
    pure: boolean;
    /** True when the chain can be rewritten as guard clauses without changing behaviour. */
    guardable: boolean;
    /** What follows the chain in its function: nothing, a single return, or other code. */
    tail: 'empty' | 'return' | 'other';
    /** The trailing return statement when `tail` is `return`. */
    tailReturn?: string;
}
