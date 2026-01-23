/**
 * Main Refactoring Coordinator
 * 
 * Orchestrates all semantic refactoring analysis.
 */

import type {
    RefactorSuggestion,
    RefactorOptions,
    MagicNumber,
} from '../types/refactor.js';
import { DEFAULT_REFACTOR_OPTIONS } from '../types/refactor.js';
import type { AIProvider, SupportedLanguage } from '../types/index.js';

import {
    detectMagicNumbersJS,
    detectMagicNumbersPython,
    suggestConstantNames,
    generateConstantSuggestions,
} from './constants.js';

import {
    detectNestedConditionalsJS,
    detectNestedConditionalsPython,
    generateConditionalSuggestions,
} from './conditionals.js';

export interface RefactorResult {
    /** All suggestions found */
    suggestions: RefactorSuggestion[];

    /** Language analyzed */
    language: SupportedLanguage;

    /** Analysis time in ms */
    analysisTime: number;
}

/**
 * Analyze code for refactoring opportunities
 */
export async function analyzeForRefactoring(
    code: string,
    language: SupportedLanguage,
    options: RefactorOptions = {},
    aiProvider?: AIProvider
): Promise<RefactorResult> {
    const startTime = Date.now();
    const opts = { ...DEFAULT_REFACTOR_OPTIONS, ...options };
    const suggestions: RefactorSuggestion[] = [];

    // Magic number detection
    if (opts.namedConstants) {
        let magicNumbers: MagicNumber[];

        if (language === 'python') {
            magicNumbers = detectMagicNumbersPython(code);
        } else {
            magicNumbers = detectMagicNumbersJS(code);
        }

        if (magicNumbers.length > 0) {
            // Get AI suggestions for constant names
            const namedMagics = await suggestConstantNames(magicNumbers, aiProvider);

            // Generate suggestions
            const constSuggestions = generateConstantSuggestions(namedMagics, language);
            suggestions.push(...constSuggestions);
        }
    }

    // Nested conditional detection
    if (opts.simplifyConditionals) {
        let nestedBlocks;

        if (language === 'python') {
            nestedBlocks = detectNestedConditionalsPython(code, opts.maxNestingDepth);
        } else {
            nestedBlocks = detectNestedConditionalsJS(code, opts.maxNestingDepth);
        }

        if (nestedBlocks.length > 0) {
            const conditionalSuggestions = generateConditionalSuggestions(nestedBlocks, language);
            suggestions.push(...conditionalSuggestions);
        }
    }

    // Filter by confidence threshold
    const filteredSuggestions = suggestions.filter(
        s => s.confidence >= opts.confidenceThreshold
    );

    return {
        suggestions: filteredSuggestions,
        language,
        analysisTime: Date.now() - startTime,
    };
}

/**
 * Apply accepted refactoring suggestions to code
 */
export function applyRefactorings(
    code: string,
    suggestions: RefactorSuggestion[]
): string {
    // Only apply accepted suggestions
    const accepted = suggestions.filter(s => s.accepted);

    if (accepted.length === 0) {
        return code;
    }

    let result = code;
    const lines = result.split('\n');

    // Sort by line number descending so we don't mess up line numbers
    const sorted = [...accepted].sort((a, b) => b.lineRange[0] - a.lineRange[0]);

    for (const suggestion of sorted) {
        if (suggestion.type === 'magic-constant' && suggestion.lineRange[0] === 1) {
            // Add constant declarations at top of file
            result = suggestion.refactored + '\n\n' + result;
        } else {
            // Replace lines
            const [start, end] = suggestion.lineRange;
            const newLines = [...lines];
            newLines.splice(start - 1, end - start + 1, suggestion.refactored);
            result = newLines.join('\n');
        }
    }

    return result;
}
