/**
 * JavaScript/TypeScript Language Plugin
 * 
 * Uses Babel for parsing and Prettier for formatting.
 */

import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import * as prettier from 'prettier';
import type { Identifier, SupportedLanguage } from '../types/index.js';
import { BaseLanguagePlugin } from './base.js';

// Handle ESM/CJS interop
const traverse = (_traverse as any).default || _traverse;
const generate = (_generate as any).default || _generate;

export class JavaScriptPlugin extends BaseLanguagePlugin {
    language: SupportedLanguage = 'javascript';
    extensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];

    /**
     * Parse code and extract all identifiers with context
     */
    extractIdentifiers(code: string): Identifier[] {
        const identifiers: Identifier[] = [];
        const seen = new Set<string>();

        try {
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: [
                    'typescript',
                    'jsx',
                    'decorators-legacy',
                    'classProperties',
                    'asyncGenerators',
                    'dynamicImport',
                    'optionalChaining',
                    'nullishCoalescingOperator',
                ],
                errorRecovery: true,
            });

            traverse(ast, {
                // Variable declarations
                VariableDeclarator: (path) => {
                    const id = path.node.id;
                    if (id.type === 'Identifier') {
                        const name = id.name;
                        const loc = id.loc;
                        if (loc && this.isShortName(name) && !seen.has(name)) {
                            seen.add(name);
                            identifiers.push({
                                name,
                                type: 'variable',
                                context: this.getContext(code, loc.start.line),
                                line: loc.start.line,
                                column: loc.start.column,
                            });
                        }
                    }
                },

                // Function declarations and expressions
                'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression': (path) => {
                    // Function name
                    const node = path.node as any;
                    if (node.id?.type === 'Identifier') {
                        const name = node.id.name;
                        const loc = node.id.loc;
                        if (loc && this.isShortName(name) && !seen.has(name)) {
                            seen.add(name);
                            identifiers.push({
                                name,
                                type: 'function',
                                context: this.getContext(code, loc.start.line),
                                line: loc.start.line,
                                column: loc.start.column,
                            });
                        }
                    }

                    // Parameters
                    for (const param of node.params) {
                        if (param.type === 'Identifier') {
                            const name = param.name;
                            const loc = param.loc;
                            if (loc && this.isShortName(name) && !seen.has(name)) {
                                seen.add(name);
                                identifiers.push({
                                    name,
                                    type: 'parameter',
                                    context: this.getContext(code, loc.start.line),
                                    line: loc.start.line,
                                    column: loc.start.column,
                                });
                            }
                        }
                    }
                },

                // Class declarations
                ClassDeclaration: (path) => {
                    const id = path.node.id;
                    if (id?.type === 'Identifier') {
                        const name = id.name;
                        const loc = id.loc;
                        if (loc && name.length <= 3 && !seen.has(name)) {
                            seen.add(name);
                            identifiers.push({
                                name,
                                type: 'class',
                                context: this.getContext(code, loc.start.line),
                                line: loc.start.line,
                                column: loc.start.column,
                            });
                        }
                    }
                },
            });
        } catch (error) {
            // Parsing failed, return empty list
            console.error('Parse error:', error);
        }

        return identifiers;
    }

    /**
     * Format code using Prettier
     */
    async format(code: string): Promise<string> {
        try {
            const formatted = await prettier.format(code, {
                parser: 'babel-ts',
                semi: true,
                singleQuote: true,
                tabWidth: 2,
                trailingComma: 'es5',
                printWidth: 100,
            });
            return formatted;
        } catch (error) {
            // If Prettier fails, return original
            console.error('Format error:', error);
            return code;
        }
    }

    /**
     * Validate syntax using Babel parser
     */
    validate(code: string): { valid: boolean; error?: string } {
        try {
            parser.parse(code, {
                sourceType: 'module',
                plugins: [
                    'typescript',
                    'jsx',
                    'decorators-legacy',
                    'classProperties',
                ],
            });
            return { valid: true };
        } catch (error: any) {
            return {
                valid: false,
                error: error.message || 'Syntax error',
            };
        }
    }

    /**
     * Detect dead code (basic implementation)
     */
    findDeadCode(code: string): Array<{ start: number; end: number; reason: string }> {
        const deadCode: Array<{ start: number; end: number; reason: string }> = [];

        try {
            const ast = parser.parse(code, {
                sourceType: 'module',
                plugins: ['typescript', 'jsx'],
                errorRecovery: true,
            });

            traverse(ast, {
                // Find unreachable code after return
                ReturnStatement: (path) => {
                    const siblings = path.container as any[];
                    if (Array.isArray(siblings)) {
                        const returnIdx = siblings.indexOf(path.node);
                        for (let i = returnIdx + 1; i < siblings.length; i++) {
                            const sibling = siblings[i];
                            if (sibling.loc) {
                                deadCode.push({
                                    start: sibling.loc.start.line,
                                    end: sibling.loc.end.line,
                                    reason: 'Unreachable code after return statement',
                                });
                            }
                        }
                    }
                },

                // Find console.log statements (optional removal)
                CallExpression: (path) => {
                    const callee = path.node.callee;
                    if (
                        callee.type === 'MemberExpression' &&
                        callee.object.type === 'Identifier' &&
                        callee.object.name === 'console' &&
                        callee.property.type === 'Identifier' &&
                        callee.property.name === 'log'
                    ) {
                        const loc = path.node.loc;
                        if (loc) {
                            deadCode.push({
                                start: loc.start.line,
                                end: loc.end.line,
                                reason: 'Debug console.log statement',
                            });
                        }
                    }
                },
            });
        } catch (error) {
            // Ignore parse errors for dead code detection
        }

        return deadCode;
    }
}
