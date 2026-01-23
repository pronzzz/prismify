/**
 * Magic Number Detection & Conversion
 * 
 * Detects unexplained numeric literals and suggests named constants.
 */

import type { MagicNumber, RefactorSuggestion } from '../types/refactor.js';
import type { AIProvider } from '../types/index.js';

/**
 * Common magic numbers that have well-known meanings
 */
const KNOWN_CONSTANTS: Record<number, string | undefined> = {
    // Time
    1000: 'ONE_SECOND_MS',
    60000: 'ONE_MINUTE_MS',
    3600000: 'ONE_HOUR_MS',
    86400000: 'ONE_DAY_MS',
    604800000: 'ONE_WEEK_MS',

    // HTTP Status
    200: 'HTTP_OK',
    201: 'HTTP_CREATED',
    204: 'HTTP_NO_CONTENT',
    400: 'HTTP_BAD_REQUEST',
    401: 'HTTP_UNAUTHORIZED',
    403: 'HTTP_FORBIDDEN',
    404: 'HTTP_NOT_FOUND',
    500: 'HTTP_INTERNAL_ERROR',

    // Common values
    0: undefined, // Skip
    1: undefined, // Skip
    2: undefined, // Skip
    100: 'PERCENTAGE_MAX',
    255: 'BYTE_MAX',
    256: 'BYTE_COUNT',
    1024: 'KILOBYTE',

    // Math
    3.14159: 'PI',
    3.141592653589793: 'PI',
    2.718281828459045: 'E',
    1.4142135623730951: 'SQRT_2',

    // Age/Legal
    18: 'ADULT_AGE',
    21: 'DRINKING_AGE_US',
    65: 'RETIREMENT_AGE',
};

/**
 * Numbers that should be ignored (too common/obvious)
 */
const SKIP_VALUES = new Set([0, 1, 2, -1, 10, 100]);

/**
 * Detect magic numbers in JavaScript/TypeScript code
 */
export function detectMagicNumbersJS(code: string): MagicNumber[] {
    const magicNumbers: MagicNumber[] = [];
    const lines = code.split('\n');

    // Regex to find numeric literals
    const numberRegex = /(?<![\w.])\b(-?\d+(?:\.\d+)?)\b(?![\w.])/g;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];

        // Skip comments and const declarations (they're already named)
        if (line.trim().startsWith('//') || line.trim().startsWith('/*')) {
            continue;
        }

        // Skip lines that are defining constants
        if (/^\s*const\s+[A-Z_]+\s*=/.test(line)) {
            continue;
        }

        let match;
        while ((match = numberRegex.exec(line)) !== null) {
            const value = parseFloat(match[1]);

            // Skip common/obvious values
            if (SKIP_VALUES.has(value)) {
                continue;
            }

            // Skip small integers in array access or simple loops
            if (Number.isInteger(value) && value >= -10 && value <= 10) {
                const context = line.slice(Math.max(0, match.index - 10), match.index + match[0].length + 10);
                if (/\[|\]|\.length|for|while/.test(context)) {
                    continue;
                }
            }

            magicNumbers.push({
                value,
                original: match[1],
                line: lineNum + 1,
                column: match.index,
                context: getContext(lines, lineNum),
            });
        }
    }

    return magicNumbers;
}

/**
 * Detect magic numbers in Python code
 */
export function detectMagicNumbersPython(code: string): MagicNumber[] {
    const magicNumbers: MagicNumber[] = [];
    const lines = code.split('\n');

    const numberRegex = /(?<![\w.])\b(-?\d+(?:\.\d+)?)\b(?![\w.])/g;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];

        // Skip comments
        if (line.trim().startsWith('#')) {
            continue;
        }

        // Skip constant definitions (UPPER_CASE = value)
        if (/^\s*[A-Z_]+\s*=/.test(line)) {
            continue;
        }

        let match;
        while ((match = numberRegex.exec(line)) !== null) {
            const value = parseFloat(match[1]);

            if (SKIP_VALUES.has(value)) {
                continue;
            }

            // Skip range() arguments that are small
            if (Number.isInteger(value) && value >= -10 && value <= 10) {
                if (/range\s*\(|len\s*\(|\[\s*\d/.test(line)) {
                    continue;
                }
            }

            magicNumbers.push({
                value,
                original: match[1],
                line: lineNum + 1,
                column: match.index,
                context: getContext(lines, lineNum),
            });
        }
    }

    return magicNumbers;
}

/**
 * Get surrounding context for a line
 */
function getContext(lines: string[], lineNum: number, contextLines: number = 3): string {
    const start = Math.max(0, lineNum - contextLines);
    const end = Math.min(lines.length, lineNum + contextLines + 1);
    return lines.slice(start, end).join('\n');
}

/**
 * Suggest constant names for magic numbers
 */
export async function suggestConstantNames(
    magicNumbers: MagicNumber[],
    aiProvider?: AIProvider
): Promise<MagicNumber[]> {
    const result: MagicNumber[] = [];

    for (const magic of magicNumbers) {
        // First check known constants
        const knownName = KNOWN_CONSTANTS[magic.value];
        if (knownName) {
            result.push({
                ...magic,
                suggestedName: knownName,
            });
            continue;
        }

        // Use AI if available
        if (aiProvider) {
            try {
                const suggestion = await aiProvider.suggestName({
                    name: magic.original,
                    type: 'variable',
                    context: `// Magic number ${magic.value} used in:\n${magic.context}`,
                    line: magic.line,
                    column: magic.column,
                });

                if (suggestion.shouldApply) {
                    // Convert to SCREAMING_SNAKE_CASE
                    const constName = toScreamingSnake(suggestion.suggested);
                    result.push({
                        ...magic,
                        suggestedName: constName,
                    });
                    continue;
                }
            } catch (e) {
                // AI failed, fall back to generic name
            }
        }

        // Fallback: generate generic name
        const genericName = generateGenericName(magic.value, magic.context);
        result.push({
            ...magic,
            suggestedName: genericName,
        });
    }

    return result;
}

/**
 * Convert a name to SCREAMING_SNAKE_CASE
 */
function toScreamingSnake(name: string): string {
    return name
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9]/g, '_')
        .toUpperCase()
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

/**
 * Generate a generic constant name based on value and context
 */
function generateGenericName(value: number, context: string): string {
    const lowerContext = context.toLowerCase();

    // Try to infer meaning from context
    if (/timeout|delay|interval|wait/.test(lowerContext)) {
        return `TIMEOUT_MS`;
    }
    if (/port|socket/.test(lowerContext)) {
        return `PORT_NUMBER`;
    }
    if (/age|years?/.test(lowerContext)) {
        return `AGE_THRESHOLD`;
    }
    if (/size|width|height|length/.test(lowerContext)) {
        return `SIZE_LIMIT`;
    }
    if (/max|limit|threshold/.test(lowerContext)) {
        return `MAX_VALUE`;
    }
    if (/min/.test(lowerContext)) {
        return `MIN_VALUE`;
    }
    if (/retry|attempt/.test(lowerContext)) {
        return `MAX_RETRIES`;
    }
    if (/page|per_page|limit/.test(lowerContext)) {
        return `PAGE_SIZE`;
    }

    // Generic fallback
    if (Number.isInteger(value) && value > 1000) {
        return `LARGE_NUMBER_${Math.abs(value)}`;
    }
    return `MAGIC_NUMBER_${String(Math.abs(value)).replace('.', '_')}`;
}

/**
 * Generate refactoring suggestions for magic numbers
 */
export function generateConstantSuggestions(
    magicNumbers: MagicNumber[],
    language: 'javascript' | 'typescript' | 'python' | 'java'
): RefactorSuggestion[] {
    const suggestions: RefactorSuggestion[] = [];

    // Group magic numbers by file position to create one constant block
    const constants = magicNumbers.filter(m => m.suggestedName);

    if (constants.length === 0) {
        return suggestions;
    }

    // Create the constant declarations
    let constBlock: string;
    if (language === 'python') {
        constBlock = constants
            .map(m => `${m.suggestedName} = ${m.original}`)
            .join('\n');
    } else {
        constBlock = constants
            .map(m => `const ${m.suggestedName} = ${m.original};`)
            .join('\n');
    }

    // Create a single suggestion for adding constants at top
    suggestions.push({
        type: 'magic-constant',
        original: `// ${constants.length} magic numbers detected`,
        refactored: constBlock,
        explanation: `Extract ${constants.length} magic number(s) into named constants for clarity`,
        confidence: 0.85,
        lineRange: [1, 1], // Add at top
    });

    // Individual replacement suggestions
    for (const magic of constants) {
        suggestions.push({
            type: 'magic-constant',
            original: magic.original,
            refactored: magic.suggestedName!,
            explanation: `Replace magic number ${magic.value} with named constant ${magic.suggestedName}`,
            confidence: 0.8,
            lineRange: [magic.line, magic.line],
        });
    }

    return suggestions;
}
