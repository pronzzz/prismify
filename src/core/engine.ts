/**
 * Prismify Core Beautification Engine
 * 
 * Orchestrates the beautification process:
 * 1. Detect language
 * 2. Parse and extract identifiers
 * 3. Get AI suggestions for renaming
 * 4. Apply formatting
 * 5. Validate output
 * 6. Generate diff and explanations
 */

import type {
    BeautifyOptions,
    BeautifyResult,
    CodeChange,
    SupportedLanguage,
    AIProvider,
    NamingSuggestion,
} from '../types/index.js';
import { getPlugin, detectLanguage } from '../languages/index.js';
import { createProvider, type ProviderType } from '../ai/index.js';

export interface EngineOptions {
    /** AI provider type */
    aiProvider?: ProviderType;
}

export class BeautifyEngine {
    private aiProvider: AIProvider | null = null;
    private options: EngineOptions;

    constructor(options: EngineOptions = {}) {
        this.options = options;
    }

    /**
     * Initialize the AI provider
     */
    async initialize(): Promise<void> {
        this.aiProvider = await createProvider(this.options.aiProvider || 'auto');
    }

    /**
     * Beautify code with the given options
     */
    async beautify(
        code: string,
        filePath: string,
        options: BeautifyOptions = {}
    ): Promise<BeautifyResult> {
        const startTime = Date.now();

        // Detect or use specified language
        const language = options.language || detectLanguage(filePath);
        if (!language) {
            return {
                original: code,
                beautified: code,
                changes: [],
                language: 'javascript' as SupportedLanguage,
                isValid: false,
                validationError: `Unable to detect language for: ${filePath}`,
                processingTime: Date.now() - startTime,
            };
        }

        const plugin = getPlugin(language);
        const changes: CodeChange[] = [];
        let beautified = code;

        try {
            // Step 1: Extract identifiers that need improvement
            const identifiers = plugin.extractIdentifiers(code);

            // Step 2: Get AI suggestions for renaming (if enabled)
            if (options.aiRenaming !== false && this.aiProvider) {
                const suggestions = await this.getSuggestions(identifiers);

                // Apply accepted suggestions
                for (const suggestion of suggestions) {
                    if (suggestion.shouldApply) {
                        const oldCode = beautified;
                        beautified = plugin.renameIdentifier(
                            beautified,
                            suggestion.original,
                            suggestion.suggested,
                            0 // Line number not used for global rename
                        );

                        if (beautified !== oldCode) {
                            changes.push({
                                type: 'rename',
                                original: suggestion.original,
                                replacement: suggestion.suggested,
                                line: 0, // Would need more context to get actual line
                                explanation: suggestion.reason,
                                confidence: suggestion.confidence,
                            });
                        }
                    }
                }
            }

            // Step 3: Apply formatting
            const formatted = await plugin.format(beautified);
            if (formatted !== beautified) {
                changes.push({
                    type: 'format',
                    original: '[formatting]',
                    replacement: '[normalized]',
                    line: 0,
                    explanation: 'Applied consistent code formatting',
                    confidence: 1.0,
                });
                beautified = formatted;
            }

            // Step 4: Optionally remove dead code
            if (options.removeDeadCode && plugin.findDeadCode) {
                const deadCode = plugin.findDeadCode(code);
                // Note: Actually removing dead code requires careful handling
                // For MVP, we just flag it in changes
                for (const dead of deadCode) {
                    changes.push({
                        type: 'remove-dead-code',
                        original: `lines ${dead.start}-${dead.end}`,
                        replacement: '[flagged for removal]',
                        line: dead.start,
                        explanation: dead.reason,
                        confidence: 0.8,
                    });
                }
            }

            // Step 5: Validate output
            const validation = plugin.validate(beautified);

            return {
                original: code,
                beautified,
                changes,
                language,
                isValid: validation.valid,
                validationError: validation.error,
                processingTime: Date.now() - startTime,
            };

        } catch (error: any) {
            return {
                original: code,
                beautified: code,
                changes: [],
                language,
                isValid: false,
                validationError: error.message || 'Unknown error during beautification',
                processingTime: Date.now() - startTime,
            };
        }
    }

    /**
     * Get AI suggestions for all identifiers
     */
    private async getSuggestions(
        identifiers: Array<{ name: string; type: string; context: string; line: number; column: number }>
    ): Promise<NamingSuggestion[]> {
        if (!this.aiProvider) return [];

        const suggestions: NamingSuggestion[] = [];

        // Process in parallel with concurrency limit
        const concurrency = 3;
        for (let i = 0; i < identifiers.length; i += concurrency) {
            const batch = identifiers.slice(i, i + concurrency);
            const results = await Promise.all(
                batch.map(id => this.aiProvider!.suggestName(id as any))
            );
            suggestions.push(...results);
        }

        return suggestions;
    }
}

/**
 * Create and initialize a beautification engine
 */
export async function createEngine(options: EngineOptions = {}): Promise<BeautifyEngine> {
    const engine = new BeautifyEngine(options);
    await engine.initialize();
    return engine;
}
