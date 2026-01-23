/**
 * Mock AI Provider
 * 
 * Uses heuristic rules instead of AI for testing and development.
 * No external dependencies required.
 */

import type { AIProvider, Identifier, NamingSuggestion } from '../types/index.js';

/**
 * Common naming patterns and their expansions
 */
const COMMON_EXPANSIONS: Record<string, string> = {
    // Single letters
    'a': 'array',
    'b': 'buffer',
    'c': 'count',
    'd': 'data',
    'e': 'element',
    'f': 'file',
    'g': 'group',
    'h': 'height',
    'i': 'index',
    'j': 'innerIndex',
    'k': 'key',
    'l': 'length',
    'm': 'map',
    'n': 'number',
    'o': 'object',
    'p': 'pointer',
    'q': 'queue',
    'r': 'result',
    's': 'string',
    't': 'temp',
    'u': 'user',
    'v': 'value',
    'w': 'width',
    'x': 'xCoord',
    'y': 'yCoord',
    'z': 'zCoord',

    // Common abbreviations
    'arr': 'array',
    'btn': 'button',
    'cb': 'callback',
    'cfg': 'config',
    'ctx': 'context',
    'db': 'database',
    'desc': 'description',
    'dir': 'directory',
    'doc': 'document',
    'el': 'element',
    'elem': 'element',
    'err': 'error',
    'evt': 'event',
    'fn': 'function',
    'func': 'function',
    'idx': 'index',
    'img': 'image',
    'len': 'length',
    'lib': 'library',
    'msg': 'message',
    'num': 'number',
    'obj': 'object',
    'opt': 'option',
    'opts': 'options',
    'param': 'parameter',
    'params': 'parameters',
    'pkg': 'package',
    'pos': 'position',
    'prev': 'previous',
    'ptr': 'pointer',
    'pwd': 'password',
    'req': 'request',
    'res': 'response',
    'resp': 'response',
    'ret': 'returnValue',
    'src': 'source',
    'str': 'string',
    'tmp': 'temporary',
    'txt': 'text',
    'usr': 'user',
    'val': 'value',
    'var': 'variable',
};

/**
 * Loop variable names that should not be expanded
 */
const LOOP_VARS = new Set(['i', 'j', 'k', 'idx', 'index']);

export class MockProvider implements AIProvider {
    name = 'mock';

    async isAvailable(): Promise<boolean> {
        return true; // Always available
    }

    async suggestName(identifier: Identifier): Promise<NamingSuggestion> {
        const { name, type, context } = identifier;

        // Skip common loop variables
        if (LOOP_VARS.has(name) && type === 'variable') {
            return {
                original: name,
                suggested: name,
                reason: 'Standard loop variable',
                confidence: 1.0,
                shouldApply: false,
            };
        }

        // Check for direct expansion
        const lowerName = name.toLowerCase();
        if (COMMON_EXPANSIONS[lowerName]) {
            const suggested = this.formatName(COMMON_EXPANSIONS[lowerName], type);
            return {
                original: name,
                suggested,
                reason: `Expanded abbreviation '${name}' to '${suggested}'`,
                confidence: 0.9,
                shouldApply: true,
            };
        }

        // Infer from context for single-letter names
        if (name.length === 1) {
            const inferredName = this.inferFromContext(name, context, type);
            if (inferredName) {
                return {
                    original: name,
                    suggested: inferredName,
                    reason: `Inferred '${inferredName}' from context`,
                    confidence: 0.75,
                    shouldApply: true,
                };
            }
        }

        // Already reasonable name
        if (name.length >= 4) {
            return {
                original: name,
                suggested: name,
                reason: 'Name is already descriptive',
                confidence: 1.0,
                shouldApply: false,
            };
        }

        // Unknown short abbreviation - keep original
        return {
            original: name,
            suggested: name,
            reason: 'Unable to determine better name',
            confidence: 0.5,
            shouldApply: false,
        };
    }

    async explainChange(before: string, after: string): Promise<string> {
        if (before.length < after.length) {
            return 'Expanded abbreviated name to improve readability';
        }
        if (before.length > after.length) {
            return 'Simplified verbose name while maintaining clarity';
        }
        return 'Renamed for better clarity and consistency';
    }

    /**
     * Try to infer a better name from the surrounding context
     */
    private inferFromContext(name: string, context: string, type: string): string | null {
        const lowerContext = context.toLowerCase();

        // Look for common patterns
        const patterns: Array<{ pattern: RegExp; name: string }> = [
            { pattern: /\.map\s*\(/i, name: 'item' },
            { pattern: /\.filter\s*\(/i, name: 'item' },
            { pattern: /\.reduce\s*\(/i, name: 'accumulator' },
            { pattern: /\.forEach\s*\(/i, name: 'item' },
            { pattern: /event|click|mouse|key/i, name: 'event' },
            { pattern: /error|catch|throw/i, name: 'error' },
            { pattern: /request|req\./i, name: 'request' },
            { pattern: /response|res\./i, name: 'response' },
            { pattern: /user|author|person/i, name: 'user' },
            { pattern: /file|path|directory/i, name: 'file' },
            { pattern: /callback|handler|listener/i, name: 'callback' },
            { pattern: /config|options|settings/i, name: 'config' },
            { pattern: /array|list|items/i, name: 'items' },
            { pattern: /count|total|sum/i, name: 'count' },
        ];

        for (const { pattern, name: inferredName } of patterns) {
            if (pattern.test(lowerContext)) {
                return this.formatName(inferredName, type);
            }
        }

        return null;
    }

    /**
     * Format name according to type conventions
     */
    private formatName(name: string, type: string): string {
        if (type === 'class') {
            // PascalCase
            return name.charAt(0).toUpperCase() + name.slice(1);
        }
        // camelCase (variable, function, parameter)
        return name.charAt(0).toLowerCase() + name.slice(1);
    }
}
