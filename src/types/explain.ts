/**
 * Types for explanatory comments.
 */

/**
 * - `production`: a one-line summary plus parameter/return tags
 * - `pr-review`: summary plus notable behaviour (side effects, errors, async)
 * - `beginner`: friendlier, longer descriptions
 */
export type ExplainLevel = 'beginner' | 'pr-review' | 'production';

export const EXPLAIN_LEVELS: ExplainLevel[] = ['production', 'pr-review', 'beginner'];

/** A documentation comment Prismify added. */
export interface Explanation {
    target: string;
    line: number;
    text: string;
    source: 'ai' | 'heuristic';
}
