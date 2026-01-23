/**
 * AI-Powered Code Explainer
 * 
 * Generates high-signal comments that explain WHY code exists,
 * not just WHAT it does.
 */

import type { AIProvider, SupportedLanguage, Identifier } from '../types/index.js';
import type {
    ExplainOptions,
    ExplainLevel,
    Explanation,
    ExplainResult
} from '../types/explain.js';
import { DEFAULT_EXPLAIN_OPTIONS, EXPLAIN_PROMPTS } from '../types/explain.js';

/**
 * Extract functions from JavaScript code for explanation
 */
function extractFunctionsJS(code: string): Array<{ name: string; line: number; body: string }> {
    const functions: Array<{ name: string; line: number; body: string }> = [];
    const lines = code.split('\n');

    // Match function declarations and expressions
    const patterns = [
        /^\s*function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/,
        /^\s*(?:const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:async\s*)?\(/,
        /^\s*(?:const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:async\s*)?function/,
        /^\s*(?:async\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*\{/, // Class methods
    ];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        for (const pattern of patterns) {
            const match = line.match(pattern);
            if (match) {
                // Get function body (simplified - just next few lines)
                const bodyLines = lines.slice(i, Math.min(i + 15, lines.length));
                functions.push({
                    name: match[1],
                    line: i + 1,
                    body: bodyLines.join('\n'),
                });
                break;
            }
        }
    }

    return functions;
}

/**
 * Extract functions from Python code
 */
function extractFunctionsPython(code: string): Array<{ name: string; line: number; body: string }> {
    const functions: Array<{ name: string; line: number; body: string }> = [];
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);

        if (match) {
            // Get function body based on indentation
            const indent = line.search(/\S/);
            const bodyLines = [line];

            for (let j = i + 1; j < lines.length && j < i + 15; j++) {
                const nextLine = lines[j];
                const nextIndent = nextLine.search(/\S/);

                if (nextLine.trim() === '' || nextIndent > indent) {
                    bodyLines.push(nextLine);
                } else {
                    break;
                }
            }

            functions.push({
                name: match[1],
                line: i + 1,
                body: bodyLines.join('\n'),
            });
        }
    }

    return functions;
}

/**
 * Generate a function explanation using AI
 */
async function generateFunctionExplanation(
    func: { name: string; line: number; body: string },
    level: ExplainLevel,
    aiProvider?: AIProvider
): Promise<Explanation | null> {
    if (!aiProvider) {
        // Fallback: generate simple explanation without AI
        return {
            type: 'function-doc',
            text: generateSimpleExplanation(func.name, func.body, level),
            line: func.line,
            confidence: 0.6,
            targetName: func.name,
        };
    }

    try {
        const explanation = await aiProvider.explainChange(
            `Function ${func.name}`,
            func.body,
        );

        return {
            type: 'function-doc',
            text: formatExplanation(explanation, level),
            line: func.line,
            confidence: 0.8,
            targetName: func.name,
        };
    } catch {
        return null;
    }
}

/**
 * Generate simple explanation without AI
 */
function generateSimpleExplanation(name: string, body: string, level: ExplainLevel): string {
    const lowerBody = body.toLowerCase();

    // Detect common patterns
    const patterns: Array<{ pattern: RegExp | string; desc: string }> = [
        { pattern: /return.*\.map\s*\(/i, desc: 'Transforms each element' },
        { pattern: /return.*\.filter\s*\(/i, desc: 'Filters elements based on criteria' },
        { pattern: /return.*\.reduce\s*\(/i, desc: 'Reduces collection to single value' },
        { pattern: /fetch\s*\(|axios|http/i, desc: 'Makes HTTP request' },
        { pattern: /async|await|promise/i, desc: 'Performs async operation' },
        { pattern: /console\.log|print/i, desc: 'Logs output for debugging' },
        { pattern: /throw|error/i, desc: 'Handles or throws errors' },
        { pattern: /if.*else|switch/i, desc: 'Contains conditional logic' },
        { pattern: /for|while|\.foreach/i, desc: 'Iterates over collection' },
        { pattern: /return\s*{/i, desc: 'Returns an object' },
        { pattern: /return\s*\[/i, desc: 'Returns an array' },
    ];

    let intent = 'Performs operation';
    for (const { pattern, desc } of patterns) {
        if (typeof pattern === 'string' ? lowerBody.includes(pattern) : pattern.test(lowerBody)) {
            intent = desc;
            break;
        }
    }

    // Format based on level
    const readableName = name
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, s => s.toUpperCase())
        .trim();

    if (level === 'beginner') {
        return `This function "${readableName}" ${intent.toLowerCase()}.\nIt takes input, processes it, and returns a result.`;
    } else if (level === 'pr-review') {
        return `${readableName}: ${intent}`;
    } else {
        return intent;
    }
}

/**
 * Format an AI explanation based on level
 */
function formatExplanation(text: string, level: ExplainLevel): string {
    const cleaned = text.trim();

    if (level === 'production') {
        // Single line only
        return cleaned.split('\n')[0].slice(0, 80);
    } else if (level === 'pr-review') {
        // Max 2 lines
        return cleaned.split('\n').slice(0, 2).join('\n');
    } else {
        // Beginner: full explanation
        return cleaned;
    }
}

/**
 * Generate file summary
 */
function generateFileSummary(
    code: string,
    language: SupportedLanguage,
    level: ExplainLevel
): Explanation {
    const lines = code.split('\n');
    const funcs = language === 'python'
        ? extractFunctionsPython(code)
        : extractFunctionsJS(code);

    const funcNames = funcs.map(f => f.name).slice(0, 5);
    const hasClasses = /class\s+\w+/.test(code);
    const hasImports = /import\s+|from\s+|require\s*\(/.test(code);
    const hasExports = /export\s+|module\.exports/.test(code);

    let summary: string;

    if (level === 'beginner') {
        summary = `/**
 * File Overview
 * 
 * This file contains ${funcs.length} function(s)${hasClasses ? ' and class definitions' : ''}.
 * ${hasImports ? 'It imports dependencies from other modules.' : ''}
 * ${hasExports ? 'It exports functionality for use elsewhere.' : ''}
 * 
 * Main functions: ${funcNames.join(', ') || 'None'}
 * Total lines: ${lines.length}
 */`;
    } else if (level === 'pr-review') {
        summary = `/**
 * ${funcs.length} functions${hasClasses ? ', classes' : ''}. Exports: ${funcNames.slice(0, 3).join(', ') || 'none'}
 */`;
    } else {
        summary = `/** ${funcNames.join(', ') || 'Utility functions'} */`;
    }

    return {
        type: 'file-summary',
        text: summary,
        line: 1,
        confidence: 0.9,
    };
}

/**
 * Format comment for specific language
 */
function formatComment(text: string, language: SupportedLanguage): string {
    if (language === 'python') {
        // Use docstring format
        if (text.includes('\n')) {
            return `"""\n${text}\n"""`;
        }
        return `"""${text}"""`;
    } else {
        // Use JSDoc format
        if (text.includes('\n')) {
            return `/**\n * ${text.split('\n').join('\n * ')}\n */`;
        }
        return `/** ${text} */`;
    }
}

/**
 * Insert comments into code
 */
function insertComments(
    code: string,
    explanations: Explanation[],
    language: SupportedLanguage
): string {
    const lines = code.split('\n');

    // Sort by line descending so insertions don't affect line numbers
    const sorted = [...explanations].sort((a, b) => b.line - a.line);

    for (const exp of sorted) {
        const comment = formatComment(exp.text, language);
        const targetLine = exp.line - 1; // 0-indexed

        if (targetLine >= 0 && targetLine < lines.length) {
            // Get indentation of target line
            const indent = lines[targetLine].match(/^(\s*)/)?.[1] || '';

            // Add indented comment before the target line
            const indentedComment = comment.split('\n').map(l => indent + l).join('\n');
            lines.splice(targetLine, 0, indentedComment);
        }
    }

    return lines.join('\n');
}

/**
 * Main explanation generator
 */
export async function generateExplanations(
    code: string,
    language: SupportedLanguage,
    options: ExplainOptions = {},
    aiProvider?: AIProvider
): Promise<ExplainResult> {
    const startTime = Date.now();
    const opts = { ...DEFAULT_EXPLAIN_OPTIONS, ...options };
    const explanations: Explanation[] = [];

    // Generate file summary
    if (opts.fileSummary) {
        const summary = generateFileSummary(code, language, opts.level);
        explanations.push(summary);
    }

    // Extract and explain functions
    if (opts.functionComments) {
        const funcs = language === 'python'
            ? extractFunctionsPython(code)
            : extractFunctionsJS(code);

        for (const func of funcs) {
            const explanation = await generateFunctionExplanation(func, opts.level, aiProvider);
            if (explanation) {
                explanations.push(explanation);
            }
        }
    }

    // Insert comments into code
    const explained = insertComments(code, explanations, language);

    return {
        original: code,
        explained,
        explanations,
        processingTime: Date.now() - startTime,
    };
}
