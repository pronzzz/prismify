/**
 * Java Language Plugin
 * 
 * Uses regex-based parsing for identifier extraction.
 * Follows standard Java naming conventions.
 */

import type { Identifier, SupportedLanguage } from '../types/index.js';
import { BaseLanguagePlugin } from './base.js';

export class JavaPlugin extends BaseLanguagePlugin {
    language: SupportedLanguage = 'java';
    extensions = ['.java'];

    /**
     * Extract identifiers using regex patterns
     */
    extractIdentifiers(code: string): Identifier[] {
        const identifiers: Identifier[] = [];
        const seen = new Set<string>();
        const lines = code.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];

            // Variable declarations: Type x = value; or Type x;
            const varMatch = line.match(/^\s*(?:final\s+)?(?:public|private|protected|static|\s)*\s*(\w+(?:<[^>]+>)?)\s+([a-z][a-zA-Z0-9]*)\s*(?:=|;)/);
            if (varMatch) {
                const name = varMatch[2];
                if (this.isShortName(name) && !seen.has(name) && !this.isJavaKeyword(name)) {
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

            // Method declarations
            const methodMatch = line.match(/^\s*(?:public|private|protected|static|\s)*\s*(?:\w+(?:<[^>]+>)?)\s+([a-z][a-zA-Z0-9]*)\s*\(/);
            if (methodMatch) {
                const name = methodMatch[1];
                // Skip common methods
                if (this.isShortName(name) && !seen.has(name) && !['main', 'get', 'set', 'run', 'init'].includes(name)) {
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
                const paramsStart = line.indexOf('(');
                const paramsEnd = line.indexOf(')');
                if (paramsStart !== -1 && paramsEnd !== -1) {
                    const paramsStr = line.slice(paramsStart + 1, paramsEnd);
                    const params = paramsStr.split(',');
                    for (const param of params) {
                        const parts = param.trim().split(/\s+/);
                        if (parts.length >= 2) {
                            const paramName = parts[parts.length - 1];
                            if (this.isShortName(paramName) && !seen.has(paramName)) {
                                seen.add(paramName);
                                identifiers.push({
                                    name: paramName,
                                    type: 'parameter',
                                    context: this.getContext(code, lineNum + 1),
                                    line: lineNum + 1,
                                    column: line.indexOf(paramName),
                                });
                            }
                        }
                    }
                }
            }

            // Class declarations
            const classMatch = line.match(/^\s*(?:public|private|protected|abstract|final|\s)*\s*class\s+([A-Z][a-zA-Z0-9]*)/);
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

            // For loop variables
            const forMatch = line.match(/for\s*\(\s*(?:\w+)\s+([a-z][a-zA-Z0-9]*)\s*[=:]/);
            if (forMatch) {
                const name = forMatch[1];
                if (this.isShortName(name) && !['i', 'j', 'k', 'idx'].includes(name) && !seen.has(name)) {
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
     * Format Java code
     */
    async format(code: string): Promise<string> {
        const lines = code.split('\n');
        const formatted: string[] = [];

        for (const line of lines) {
            let formattedLine = line;

            // Normalize indentation to 4 spaces
            const leadingWhitespace = formattedLine.match(/^(\s*)/)?.[1] || '';
            const tabCount = (leadingWhitespace.match(/\t/g) || []).length;
            if (tabCount > 0) {
                formattedLine = formattedLine.replace(/^\t+/, '    '.repeat(tabCount));
            }

            // Add space after commas
            formattedLine = formattedLine.replace(/,([^\s])/g, ', $1');

            // Add space after keywords
            formattedLine = formattedLine.replace(/\b(if|for|while|switch|catch)\(/g, '$1 (');

            // Add space around binary operators
            formattedLine = formattedLine.replace(/([^=<>!])=([^=])/g, '$1 = $2');

            // Remove trailing whitespace
            formattedLine = formattedLine.trimEnd();

            formatted.push(formattedLine);
        }

        // Ensure file ends with newline
        let result = formatted.join('\n');
        if (!result.endsWith('\n')) {
            result += '\n';
        }

        return result;
    }

    /**
     * Basic Java syntax validation
     */
    validate(code: string): { valid: boolean; error?: string } {
        const lines = code.split('\n');

        // Count braces
        let braceCount = 0;
        let parenCount = 0;
        let bracketCount = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Skip comments
            if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
                continue;
            }

            for (const char of line) {
                if (char === '{') braceCount++;
                if (char === '}') braceCount--;
                if (char === '(') parenCount++;
                if (char === ')') parenCount--;
                if (char === '[') bracketCount++;
                if (char === ']') bracketCount--;

                if (braceCount < 0) {
                    return { valid: false, error: `Line ${i + 1}: Unexpected closing brace` };
                }
                if (parenCount < 0) {
                    return { valid: false, error: `Line ${i + 1}: Unexpected closing parenthesis` };
                }
                if (bracketCount < 0) {
                    return { valid: false, error: `Line ${i + 1}: Unexpected closing bracket` };
                }
            }
        }

        if (braceCount !== 0) {
            return { valid: false, error: 'Unbalanced braces' };
        }
        if (parenCount !== 0) {
            return { valid: false, error: 'Unbalanced parentheses' };
        }
        if (bracketCount !== 0) {
            return { valid: false, error: 'Unbalanced brackets' };
        }

        return { valid: true };
    }

    /**
     * Check if a word is a Java keyword
     */
    private isJavaKeyword(word: string): boolean {
        const keywords = [
            'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch',
            'char', 'class', 'const', 'continue', 'default', 'do', 'double',
            'else', 'enum', 'extends', 'final', 'finally', 'float', 'for',
            'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface',
            'long', 'native', 'new', 'package', 'private', 'protected', 'public',
            'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized',
            'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while',
            'true', 'false', 'null',
        ];
        return keywords.includes(word);
    }

    /**
     * Detect dead code patterns
     */
    findDeadCode(code: string): Array<{ start: number; end: number; reason: string }> {
        const deadCode: Array<{ start: number; end: number; reason: string }> = [];
        const lines = code.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // System.out.println statements
            if (line.includes('System.out.println') || line.includes('System.out.print')) {
                deadCode.push({
                    start: i + 1,
                    end: i + 1,
                    reason: 'Debug print statement',
                });
            }

            // TODO comments (optional flag)
            if (line.includes('// TODO') || line.includes('// FIXME')) {
                // Not dead code, but could flag for review
            }
        }

        return deadCode;
    }
}
