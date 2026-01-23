/**
 * Base Language Plugin
 * 
 * Abstract base class for language-specific beautification plugins.
 */

import type { LanguagePlugin, SupportedLanguage, Identifier } from '../types/index.js';

export abstract class BaseLanguagePlugin implements LanguagePlugin {
    abstract language: SupportedLanguage;
    abstract extensions: string[];

    abstract extractIdentifiers(code: string): Identifier[];
    abstract format(code: string): Promise<string>;
    abstract validate(code: string): { valid: boolean; error?: string };

    /**
     * Rename an identifier throughout the code
     * Uses word boundary matching to avoid partial replacements
     */
    renameIdentifier(code: string, oldName: string, newName: string, _line: number): string {
        if (oldName === newName) return code;

        // Create regex with word boundaries
        const pattern = new RegExp(`\\b${this.escapeRegex(oldName)}\\b`, 'g');
        return code.replace(pattern, newName);
    }

    /**
     * Escape special regex characters
     */
    protected escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Extract lines around a position for context
     */
    protected getContext(code: string, line: number, contextLines: number = 5): string {
        const lines = code.split('\n');
        const start = Math.max(0, line - contextLines);
        const end = Math.min(lines.length, line + contextLines);
        return lines.slice(start, end).join('\n');
    }

    /**
     * Check if a name appears to be intentionally short/cryptic
     */
    protected isShortName(name: string): boolean {
        return name.length <= 2 || /^[a-z]$|^[a-z][0-9]$/i.test(name);
    }
}
