/**
 * Python Language Plugin
 * 
 * Uses regex-based parsing for identifier extraction.
 * Python formatting follows PEP 8 conventions.
 */

import type { Identifier, SupportedLanguage } from '../types/index.js';
import { BaseLanguagePlugin } from './base.js';

export class PythonPlugin extends BaseLanguagePlugin {
    language: SupportedLanguage = 'python';
    extensions = ['.py', '.pyw'];

    /**
     * Extract identifiers using regex patterns
     */
    extractIdentifiers(code: string): Identifier[] {
        const identifiers: Identifier[] = [];
        const seen = new Set<string>();
        const lines = code.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];

            // Variable assignments: x = value, x: type = value
            const varMatch = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?::\s*\w+)?\s*=/);
            if (varMatch) {
                const name = varMatch[1];
                if (this.isShortName(name) && !seen.has(name) && !this.isPythonKeyword(name)) {
                    seen.add(name);
                    identifiers.push({
                        name,
                        type: 'variable',
                        context: this.getContext(code, lineNum + 1),
                        line: lineNum + 1,
                        column: line.indexOf(name),
                    });
                }
            }

            // Function definitions: def fn(params):
            const funcMatch = line.match(/^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
            if (funcMatch) {
                const name = funcMatch[1];
                if (this.isShortName(name) && !seen.has(name) && !name.startsWith('_')) {
                    seen.add(name);
                    identifiers.push({
                        name,
                        type: 'function',
                        context: this.getContext(code, lineNum + 1),
                        line: lineNum + 1,
                        column: line.indexOf(name),
                    });
                }

                // Extract parameters
                const paramsMatch = line.match(/def\s+\w+\s*\(([^)]*)\)/);
                if (paramsMatch) {
                    const params = paramsMatch[1].split(',');
                    for (const param of params) {
                        const cleanParam = param.trim().split(':')[0].split('=')[0].trim();
                        if (cleanParam && this.isShortName(cleanParam) && !seen.has(cleanParam)) {
                            // Skip *args, **kwargs, self
                            if (!cleanParam.startsWith('*') && cleanParam !== 'self' && cleanParam !== 'cls') {
                                seen.add(cleanParam);
                                identifiers.push({
                                    name: cleanParam,
                                    type: 'parameter',
                                    context: this.getContext(code, lineNum + 1),
                                    line: lineNum + 1,
                                    column: line.indexOf(cleanParam),
                                });
                            }
                        }
                    }
                }
            }

            // Class definitions: class Cls:
            const classMatch = line.match(/^\s*class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[:(]/);
            if (classMatch) {
                const name = classMatch[1];
                if (name.length <= 3 && !seen.has(name)) {
                    seen.add(name);
                    identifiers.push({
                        name,
                        type: 'class',
                        context: this.getContext(code, lineNum + 1),
                        line: lineNum + 1,
                        column: line.indexOf(name),
                    });
                }
            }

            // For loop variables: for x in items:
            const forMatch = line.match(/^\s*for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\s+/);
            if (forMatch) {
                const name = forMatch[1];
                // Skip common loop vars like i, j, k
                if (this.isShortName(name) && !['i', 'j', 'k', 'idx', '_'].includes(name) && !seen.has(name)) {
                    seen.add(name);
                    identifiers.push({
                        name,
                        type: 'variable',
                        context: this.getContext(code, lineNum + 1),
                        line: lineNum + 1,
                        column: line.indexOf(name),
                    });
                }
            }
        }

        return identifiers;
    }

    /**
     * Format Python code (basic PEP 8 formatting)
     */
    async format(code: string): Promise<string> {
        const lines = code.split('\n');
        const formatted: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // Normalize indentation to 4 spaces
            const leadingWhitespace = line.match(/^(\s*)/)?.[1] || '';
            const tabCount = (leadingWhitespace.match(/\t/g) || []).length;
            if (tabCount > 0) {
                const spaces = '    '.repeat(tabCount);
                line = line.replace(/^\t+/, spaces);
            }

            // Add space after commas
            line = line.replace(/,([^\s])/g, ', $1');

            // Add spaces around operators (simple cases)
            line = line.replace(/([^=<>!])=([^=])/g, '$1 = $2');
            line = line.replace(/([^<>])([<>])([^=<>])/g, '$1 $2 $3');

            // Remove trailing whitespace
            line = line.trimEnd();

            formatted.push(line);
        }

        // Ensure file ends with newline
        let result = formatted.join('\n');
        if (!result.endsWith('\n')) {
            result += '\n';
        }

        return result;
    }

    /**
     * Basic Python syntax validation
     */
    validate(code: string): { valid: boolean; error?: string } {
        const lines = code.split('\n');
        let indentStack: number[] = [0];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Skip empty lines and comments
            if (line.trim() === '' || line.trim().startsWith('#')) {
                continue;
            }

            // Check for unbalanced parentheses/brackets
            const opens = (line.match(/[([{]/g) || []).length;
            const closes = (line.match(/[)\]}]/g) || []).length;
            if (opens !== closes && !line.includes('"""') && !line.includes("'''")) {
                // Multi-line expressions are okay, this is a simple check
            }

            // Check for invalid def/class syntax
            if (line.trim().startsWith('def ') && !line.includes('(')) {
                return { valid: false, error: `Line ${i + 1}: Invalid function definition` };
            }
            if (line.trim().startsWith('class ') && !line.includes(':')) {
                return { valid: false, error: `Line ${i + 1}: Invalid class definition` };
            }
        }

        return { valid: true };
    }

    /**
     * Check if a word is a Python keyword
     */
    private isPythonKeyword(word: string): boolean {
        const keywords = [
            'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
            'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
            'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
            'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
            'while', 'with', 'yield',
        ];
        return keywords.includes(word);
    }

    /**
     * Detect dead code patterns
     */
    findDeadCode(code: string): Array<{ start: number; end: number; reason: string }> {
        const deadCode: Array<{ start: number; end: number; reason: string }> = [];
        const lines = code.split('\n');

        let afterReturn = false;
        let returnLine = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Track return statements
            if (line.startsWith('return ') || line === 'return') {
                afterReturn = true;
                returnLine = i + 1;
                continue;
            }

            // Code after return (same indentation level)
            if (afterReturn && line !== '' && !line.startsWith('def ') && !line.startsWith('class ')) {
                const currentIndent = (lines[i].match(/^\s*/)?.[0] || '').length;
                const returnIndent = (lines[returnLine - 1].match(/^\s*/)?.[0] || '').length;

                if (currentIndent === returnIndent) {
                    deadCode.push({
                        start: i + 1,
                        end: i + 1,
                        reason: 'Unreachable code after return statement',
                    });
                }
            }

            // Reset after new function/class
            if (line.startsWith('def ') || line.startsWith('class ')) {
                afterReturn = false;
            }

            // Detect print statements in what looks like production code
            if (line.startsWith('print(') && !code.includes('if __name__')) {
                deadCode.push({
                    start: i + 1,
                    end: i + 1,
                    reason: 'Debug print statement',
                });
            }
        }

        return deadCode;
    }
}
