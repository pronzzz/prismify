/**
 * Explainability Types
 * 
 * Type definitions for Phase 3 explanation features.
 */

/**
 * Explanation detail levels
 */
export type ExplainLevel = 'beginner' | 'pr-review' | 'production';

/**
 * Options for explanation generation
 */
export interface ExplainOptions {
    /** Level of detail in explanations */
    level?: ExplainLevel;

    /** Generate file-level summary */
    fileSummary?: boolean;

    /** Generate function-level comments */
    functionComments?: boolean;

    /** Add inline comments for complex logic */
    inlineComments?: boolean;
}

/**
 * Default explain options
 */
export const DEFAULT_EXPLAIN_OPTIONS: Required<ExplainOptions> = {
    level: 'production',
    fileSummary: true,
    functionComments: true,
    inlineComments: false, // Only for beginner mode
};

/**
 * A generated explanation/comment
 */
export interface Explanation {
    /** Type of explanation */
    type: 'file-summary' | 'function-doc' | 'inline-comment';

    /** The explanation text */
    text: string;

    /** Target location (line number, 1-indexed) */
    line: number;

    /** Confidence score 0-1 */
    confidence: number;

    /** Name of the function/element being explained */
    targetName?: string;
}

/**
 * Result of explanation analysis
 */
export interface ExplainResult {
    /** Original code */
    original: string;

    /** Code with explanations added */
    explained: string;

    /** All explanations generated */
    explanations: Explanation[];

    /** Processing time in ms */
    processingTime: number;
}

/**
 * Prompts for different explanation levels
 */
export const EXPLAIN_PROMPTS: Record<ExplainLevel, string> = {
    beginner: `You are explaining code to a junior developer. Be friendly and thorough:
- Explain what the code does step by step
- Explain WHY this approach was chosen
- Point out any patterns or best practices
- Keep language simple and accessible`,

    'pr-review': `You are a senior engineer doing a code review. Be concise and focused:
- Focus on what's important for reviewers to know
- Highlight any potential issues or risks
- Note any hardcoded values or technical debt
- Keep comments brief but informative`,

    production: `You are documenting production code. Be minimal and precise:
- One-line summary only
- Only document non-obvious behavior
- Skip explanation if code is self-documenting
- Use standard JSDoc/docstring format`,
};
