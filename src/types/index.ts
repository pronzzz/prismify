/**
 * Shared type definitions for the Prismify engine.
 */

export * from './refactor.js';
export * from './explain.js';

import type { StyleProfile } from '../styles/profiles.js';
import type { RefactorSuggestion } from './refactor.js';
import type { Explanation, ExplainLevel } from './explain.js';

/** Languages Prismify understands. */
export type SupportedLanguage = 'javascript' | 'typescript' | 'python' | 'java';

/** What kind of thing an identifier names. */
export type IdentifierKind = 'variable' | 'function' | 'class' | 'parameter';

/**
 * Evidence gathered from the code about what an identifier holds.
 * Heuristic naming only renames when one of these gives a strong signal.
 */
export interface IdentifierHints {
    /** Name of the property/key/getter it was read from (`const n = user.name` → `name`). */
    initFrom?: string;
    /** Role inferred from how the value is used. */
    role?: 'accumulator' | 'counter' | 'result' | 'error' | 'element' | 'event' | 'text' | 'items';
    /** Collection a loop/callback variable iterates over (`users.map(u => …)` → `users`). */
    iterates?: string;
    /** Properties read from this identifier (`u.name`, `u.age`). Used as AI context. */
    usedProperties?: string[];
}

/** A rename candidate found by a language plugin. */
export interface Identifier {
    /** Unique key for this binding within the file (`name@line:column`). */
    id: string;
    /** Current name. */
    name: string;
    type: IdentifierKind;
    /** Surrounding code, used as AI context. */
    context: string;
    /** 1-indexed line. */
    line: number;
    /** 0-indexed column. */
    column: number;
    hints?: IdentifierHints;
}

/** A proposed rename for one binding. */
export interface NamingSuggestion {
    id: string;
    original: string;
    suggested: string;
    reason: string;
    /** 0–1. */
    confidence: number;
    /** Where the suggestion came from. */
    source: 'ai' | 'heuristic';
}

/** A rename that was applied to the code. */
export interface AppliedRename {
    id: string;
    from: string;
    to: string;
    line: number;
    reason: string;
    confidence: number;
    source: 'ai' | 'heuristic';
}

/** A rename that was proposed but not applied, and why. */
export interface SkippedRename {
    id: string;
    from: string;
    to: string;
    line: number;
    why: string;
}

/** A function found in the source, used for documentation comments. */
export interface FunctionInfo {
    id: string;
    name: string;
    /** 1-indexed line where a doc comment should be inserted (JS/Java) or the `def` line (Python). */
    line: number;
    params: string[];
    /** Already has a doc comment / docstring. */
    hasDoc: boolean;
    isAsync: boolean;
    returnsValue: boolean;
    /** Source of the function (trimmed to a reasonable size). */
    body: string;
    /** Observed behaviours, e.g. "throws", "logs", "network". */
    traits: string[];
}

/** Dead or debug-only code found in the source. */
export interface DeadCode {
    start: number;
    end: number;
    reason: string;
}

/** What a formatter needs to know. */
export interface FormatContext {
    profile: StyleProfile;
    /** Path of the file being formatted (used to find project formatter config). */
    filePath: string;
    /** Merge the project's own formatter config (e.g. .prettierrc) over the profile. */
    projectConfig: boolean;
}

/** Interface every language plugin implements. */
export interface LanguagePlugin {
    language: SupportedLanguage;
    extensions: string[];
    /** Whether this plugin can rename identifiers safely. */
    canRename: boolean;

    /** Find identifiers that are candidates for renaming. */
    extractIdentifiers(code: string, opts: { minNameLength: number }): Identifier[];

    /**
     * Apply renames (keyed by identifier id). Each rename is checked for
     * collisions and scope safety; unsafe ones are returned in `skipped`.
     */
    applyRenames(
        code: string,
        renames: NamingSuggestion[]
    ): { code: string; applied: AppliedRename[]; skipped: SkippedRename[] };

    /** Format the code according to a style profile. */
    format(code: string, ctx: FormatContext): Promise<string>;

    /** Check that code parses. `checked` is false when no parser was available. */
    validate(code: string): Promise<{ valid: boolean; checked: boolean; error?: string }>;

    /** Functions in the file (for explanatory comments). */
    extractFunctions(code: string): FunctionInfo[];

    /** Insert documentation comments. */
    insertDocs(code: string, docs: Array<{ fn: FunctionInfo; text: string }>): string;

    findDeadCode(code: string): DeadCode[];
    detectMagicNumbers(code: string): import('./refactor.js').MagicNumber[];
    detectNestedConditionals(code: string, maxDepth: number): import('./refactor.js').NestedConditional[];
}

/** Context passed to AI providers alongside candidates. */
export interface ProviderContext {
    language: SupportedLanguage;
    code: string;
    filePath: string;
}

/** A source of naming and documentation suggestions. */
export interface AIProvider {
    /** `ollama` or `heuristic`. */
    name: string;
    /** Human readable description, e.g. "ollama (qwen2.5-coder:7b)". */
    label: string;
    suggestNames(candidates: Identifier[], ctx: ProviderContext): Promise<NamingSuggestion[]>;
    summarizeFunctions(
        fns: FunctionInfo[],
        level: ExplainLevel,
        ctx: ProviderContext
    ): Promise<Map<string, string>>;
}

/** Options for one beautify run. */
export interface BeautifyOptions {
    language?: SupportedLanguage;
    /** Rename cryptic identifiers. Default true. */
    rename?: boolean;
    /** Run the formatter. Default true. */
    format?: boolean;
    /** Add documentation comments. */
    explain?: boolean;
    explainLevel?: ExplainLevel;
    /** Report refactoring suggestions. */
    refactor?: boolean;
    /** Report dead/debug code. */
    deadCode?: boolean;
    /** Style profile to apply. */
    profile: StyleProfile;
    /** Minimum confidence for a rename to be applied (0–1). Default 0.7. */
    confidence?: number;
}

/** A single change, for reporting. */
export interface CodeChange {
    type: 'rename' | 'format' | 'docs';
    summary: string;
    line?: number;
}

/** Result of beautifying one file. */
export interface BeautifyResult {
    filePath: string;
    language: SupportedLanguage;
    original: string;
    beautified: string;
    changed: boolean;
    renames: AppliedRename[];
    skippedRenames: SkippedRename[];
    docs: Explanation[];
    suggestions: RefactorSuggestion[];
    deadCode: DeadCode[];
    changes: CodeChange[];
    /** Problems that did not stop processing (e.g. formatter unavailable). */
    warnings: string[];
    /** Set when the file could not be processed; `beautified` equals `original`. */
    error?: string;
    processingTime: number;
}
