/**
 * Analysis Module Exports
 */

export { analyzeForRefactoring, applyRefactorings, type RefactorResult } from './refactor.js';
export {
    detectMagicNumbersJS,
    detectMagicNumbersPython,
    suggestConstantNames,
    generateConstantSuggestions,
} from './constants.js';
export {
    detectNestedConditionalsJS,
    detectNestedConditionalsPython,
    generateConditionalSuggestions,
    generateEarlyReturn,
} from './conditionals.js';
