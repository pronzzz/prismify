/**
 * Conditional Simplification
 * 
 * Detects deeply nested conditionals and suggests early return patterns.
 */

import type { NestedConditional, RefactorSuggestion } from '../types/refactor.js';

/**
 * Detect nested conditionals in JavaScript/TypeScript code
 */
export function detectNestedConditionalsJS(
    code: string,
    maxDepth: number = 3
): NestedConditional[] {
    const nestedBlocks: NestedConditional[] = [];
    const lines = code.split('\n');

    // Track nesting depth
    let currentDepth = 0;
    let ifStack: Array<{ line: number; depth: number; code: string[] }> = [];
    let braceCount = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Count braces to track scope
        const opens = (line.match(/{/g) || []).length;
        const closes = (line.match(/}/g) || []).length;

        // Detect if statement
        if (/^\s*if\s*\(/.test(line)) {
            currentDepth++;
            ifStack.push({
                line: i + 1,
                depth: currentDepth,
                code: [line],
            });
        }

        // Track code within nested blocks
        if (ifStack.length > 0) {
            const current = ifStack[ifStack.length - 1];
            if (i + 1 !== current.line) {
                current.code.push(line);
            }
        }

        // Handle closing braces
        braceCount += opens - closes;
        if (closes > 0 && ifStack.length > 0) {
            const current = ifStack[ifStack.length - 1];

            // Check if this closes the current if block
            if (current.depth > maxDepth) {
                nestedBlocks.push({
                    depth: current.depth,
                    startLine: current.line,
                    endLine: i + 1,
                    code: current.code.join('\n'),
                });
            }

            ifStack.pop();
            currentDepth = Math.max(0, currentDepth - 1);
        }
    }

    return nestedBlocks;
}

/**
 * Detect nested conditionals in Python code
 */
export function detectNestedConditionalsPython(
    code: string,
    maxDepth: number = 3
): NestedConditional[] {
    const nestedBlocks: NestedConditional[] = [];
    const lines = code.split('\n');

    let currentDepth = 0;
    let ifStack: Array<{ line: number; depth: number; indent: number; code: string[] }> = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed === '' || trimmed.startsWith('#')) {
            continue;
        }

        // Calculate indentation
        const indent = line.search(/\S/);
        if (indent === -1) continue;

        // Pop stack for dedented lines
        while (ifStack.length > 0 && indent <= ifStack[ifStack.length - 1].indent) {
            const popped = ifStack.pop()!;
            if (popped.depth > maxDepth) {
                nestedBlocks.push({
                    depth: popped.depth,
                    startLine: popped.line,
                    endLine: i,
                    code: popped.code.join('\n'),
                });
            }
            currentDepth = Math.max(0, currentDepth - 1);
        }

        // Detect if statement
        if (/^\s*if\s+/.test(line) && line.trim().endsWith(':')) {
            currentDepth++;
            ifStack.push({
                line: i + 1,
                depth: currentDepth,
                indent,
                code: [line],
            });
        } else if (ifStack.length > 0) {
            // Track code within nested blocks
            ifStack[ifStack.length - 1].code.push(line);
        }
    }

    // Handle remaining stack
    while (ifStack.length > 0) {
        const popped = ifStack.pop()!;
        if (popped.depth > maxDepth) {
            nestedBlocks.push({
                depth: popped.depth,
                startLine: popped.line,
                endLine: lines.length,
                code: popped.code.join('\n'),
            });
        }
    }

    return nestedBlocks;
}

/**
 * Generate early return version of nested conditional
 * 
 * Transforms:
 * ```
 * if (a) {
 *   if (b) {
 *     if (c) {
 *       doSomething();
 *     }
 *   }
 * }
 * ```
 * 
 * Into:
 * ```
 * if (!a) return;
 * if (!b) return;
 * if (!c) return;
 * doSomething();
 * ```
 */
export function generateEarlyReturn(
    nested: NestedConditional,
    language: 'javascript' | 'typescript' | 'python'
): string {
    const lines = nested.code.split('\n');
    const conditions: string[] = [];
    const bodyLines: string[] = [];

    // Extract conditions from nested ifs
    for (const line of lines) {
        const trimmed = line.trim();

        // JavaScript/TypeScript if
        const jsMatch = trimmed.match(/^if\s*\((.+)\)\s*\{?$/);
        if (jsMatch) {
            conditions.push(jsMatch[1]);
            continue;
        }

        // Python if
        const pyMatch = trimmed.match(/^if\s+(.+):$/);
        if (pyMatch) {
            conditions.push(pyMatch[1]);
            continue;
        }

        // Skip braces and empty lines
        if (trimmed === '{' || trimmed === '}' || trimmed === '') {
            continue;
        }

        // This is body code
        bodyLines.push(trimmed);
    }

    // Generate early return code
    let result: string;

    if (language === 'python') {
        const guards = conditions.map(c => `if not (${c}):\n    return`);
        result = guards.join('\n') + '\n' + bodyLines.join('\n');
    } else {
        const guards = conditions.map(c => `if (!(${c})) return;`);
        result = guards.join('\n') + '\n' + bodyLines.join('\n');
    }

    return result;
}

/**
 * Generate refactoring suggestions for nested conditionals
 */
export function generateConditionalSuggestions(
    nestedBlocks: NestedConditional[],
    language: 'javascript' | 'typescript' | 'python' | 'java'
): RefactorSuggestion[] {
    const suggestions: RefactorSuggestion[] = [];

    for (const block of nestedBlocks) {
        const simplified = generateEarlyReturn(
            block,
            language === 'java' ? 'javascript' : language
        );

        suggestions.push({
            type: 'simplify-conditional',
            original: block.code,
            refactored: simplified,
            explanation: `Flatten ${block.depth}-level nested conditional using early returns`,
            confidence: 0.75,
            lineRange: [block.startLine, block.endLine],
        });
    }

    return suggestions;
}
