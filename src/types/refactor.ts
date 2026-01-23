/**
 * Refactoring Types
 * 
 * Type definitions for Phase 2 semantic refactoring features.
 */

/**
 * Types of refactoring suggestions
 */
export type RefactorType =
    | 'simplify-conditional'
    | 'extract-function'
    | 'magic-constant'
    | 'group-logic';

/**
 * A single refactoring suggestion
 */
export interface RefactorSuggestion {
    /** Type of refactoring */
    type: RefactorType;

    /** Original code fragment */
    original: string;

    /** Suggested refactored code */
    refactored: string;

    /** Human-readable explanation */
    explanation: string;

    /** Confidence score 0-1 */
    confidence: number;

    /** Line range affected [start, end] (1-indexed) */
    lineRange: [number, number];

    /** Whether user has accepted this suggestion */
    accepted?: boolean;
}

/**
 * Options for refactoring analysis
 */
export interface RefactorOptions {
    /** Extract repeated logic into helper functions */
    extractHelpers?: boolean;

    /** Simplify nested conditionals with early returns */
    simplifyConditionals?: boolean;

    /** Convert magic numbers to named constants */
    namedConstants?: boolean;

    /** Group related logic with section comments */
    groupLogic?: boolean;

    /** Maximum nesting depth before suggesting simplification (default: 3) */
    maxNestingDepth?: number;

    /** Minimum confidence to include a suggestion (default: 0.6) */
    confidenceThreshold?: number;
}

/**
 * Default refactoring options
 */
export const DEFAULT_REFACTOR_OPTIONS: Required<RefactorOptions> = {
    extractHelpers: true,
    simplifyConditionals: true,
    namedConstants: true,
    groupLogic: false, // Disabled by default
    maxNestingDepth: 3,
    confidenceThreshold: 0.6,
};

/**
 * Detected magic number
 */
export interface MagicNumber {
    /** The numeric value */
    value: number;

    /** Original code representation */
    original: string;

    /** Line number (1-indexed) */
    line: number;

    /** Column number (0-indexed) */
    column: number;

    /** Surrounding context for AI naming */
    context: string;

    /** AI-suggested constant name */
    suggestedName?: string;
}

/**
 * Nested conditional block
 */
export interface NestedConditional {
    /** Nesting depth (1 = not nested) */
    depth: number;

    /** Start line (1-indexed) */
    startLine: number;

    /** End line (1-indexed) */
    endLine: number;

    /** Original code */
    code: string;

    /** Simplified version using early returns */
    simplified?: string;
}
