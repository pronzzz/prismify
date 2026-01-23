/**
 * Ollama AI Provider
 * 
 * Implements AI-powered naming suggestions with multiple anti-hallucination constraints:
 * 1. Low temperature (0.1) for deterministic outputs
 * 2. Constrained prompts with explicit rules
 * 3. Consistency checking (query multiple times, require agreement)
 * 4. Output validation (must be valid identifier)
 * 5. Confidence scoring based on context analysis
 */

import { Ollama } from 'ollama';
import type {
    AIProvider,
    Identifier,
    NamingSuggestion,
    OllamaConfig
} from '../types/index.js';
import { DEFAULT_OLLAMA_CONFIG } from '../types/index.js';

export class OllamaProvider implements AIProvider {
    name = 'ollama';
    private client: Ollama;
    private config: OllamaConfig;

    constructor(config: Partial<OllamaConfig> = {}) {
        this.config = { ...DEFAULT_OLLAMA_CONFIG, ...config };
        this.client = new Ollama({ host: 'http://127.0.0.1:11434' });
    }

    async isAvailable(): Promise<boolean> {
        try {
            await this.client.list();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Suggest a better name for an identifier with anti-hallucination measures
     */
    async suggestName(identifier: Identifier): Promise<NamingSuggestion> {
        // Skip if name already looks good
        if (this.isAlreadyDescriptive(identifier.name)) {
            return {
                original: identifier.name,
                suggested: identifier.name,
                reason: 'Name is already descriptive',
                confidence: 1.0,
                shouldApply: false,
            };
        }

        // Build constrained prompt
        const prompt = this.buildNamingPrompt(identifier);

        // Query multiple times for consistency
        const suggestions: string[] = [];
        for (let i = 0; i < this.config.consistencyChecks; i++) {
            const suggestion = await this.querySingleName(prompt);
            if (suggestion && this.isValidIdentifier(suggestion, identifier.type)) {
                suggestions.push(suggestion.toLowerCase());
            }
        }

        // Check consistency - find most common suggestion
        const { bestName, agreementRatio } = this.findConsensus(suggestions);

        if (!bestName || agreementRatio < this.config.consistencyThreshold) {
            return {
                original: identifier.name,
                suggested: identifier.name,
                reason: 'AI suggestions were inconsistent, keeping original',
                confidence: agreementRatio,
                shouldApply: false,
            };
        }

        // Calculate final confidence
        const confidence = this.calculateConfidence(identifier, bestName, agreementRatio);

        // Format the name properly based on type
        const formattedName = this.formatName(bestName, identifier.type);

        return {
            original: identifier.name,
            suggested: formattedName,
            reason: await this.generateReason(identifier, formattedName),
            confidence,
            shouldApply: confidence >= this.config.confidenceThreshold,
        };
    }

    /**
     * Explain a code change
     */
    async explainChange(before: string, after: string): Promise<string> {
        const prompt = `You are a code reviewer. Explain in ONE short sentence why this change improves readability.

BEFORE:
${before.slice(0, 200)}

AFTER:
${after.slice(0, 200)}

Explanation (one sentence only):`;

        try {
            const response = await this.client.generate({
                model: this.config.model,
                prompt,
                options: {
                    temperature: 0.2,
                    top_p: 0.9,
                    num_predict: 100,
                },
                stream: false,
            });

            return response.response.trim().split('\n')[0]; // Only first line
        } catch {
            return 'Improved code readability';
        }
    }

    /**
     * Build a highly constrained prompt to minimize hallucination
     */
    private buildNamingPrompt(identifier: Identifier): string {
        const typeLabel = identifier.type === 'function' ? 'function' :
            identifier.type === 'class' ? 'class' : 'variable';

        return `You are a code naming expert. Suggest ONE better name for a ${typeLabel}.

RULES:
1. Reply with ONLY the new name, nothing else
2. Use camelCase for variables/functions, PascalCase for classes
3. Name must be 2-30 characters
4. Be descriptive but concise
5. No special characters, only letters and numbers
6. If the current name is already good, reply with the same name

Current name: ${identifier.name}
Context:
${identifier.context.slice(0, 300)}

Better name:`;
    }

    /**
     * Query Ollama for a single name suggestion
     */
    private async querySingleName(prompt: string): Promise<string | null> {
        try {
            const response = await this.client.generate({
                model: this.config.model,
                prompt,
                options: {
                    temperature: this.config.temperature,
                    top_p: this.config.topP,
                    top_k: this.config.topK,
                    num_predict: this.config.maxTokens,
                },
                stream: false,
            });

            // Extract just the name from response
            const rawResponse = response.response.trim();
            const name = rawResponse.split(/[\s\n:`'".,;(){}[\]]+/)[0];

            return name || null;
        } catch {
            return null;
        }
    }

    /**
     * Check if a name is already descriptive enough
     */
    private isAlreadyDescriptive(name: string): boolean {
        // Skip single-letter names except common loop vars
        if (name.length === 1 && !['i', 'j', 'k', 'x', 'y', 'z'].includes(name)) {
            return false;
        }

        // Skip very short cryptic names
        if (name.length <= 2) {
            return false;
        }

        // Skip names that are all consonants or look like abbreviations
        if (/^[bcdfghjklmnpqrstvwxz]+$/i.test(name) && name.length <= 4) {
            return false;
        }

        // Allow loop variables
        if (['i', 'j', 'k', 'idx', 'index', 'key', 'val', 'value'].includes(name.toLowerCase())) {
            return true;
        }

        // Name looks reasonable if it's 4+ chars with vowels
        return name.length >= 4;
    }

    /**
     * Check if a suggested name is a valid identifier
     */
    private isValidIdentifier(name: string, type: string): boolean {
        // Must be reasonable length
        if (name.length < 2 || name.length > 30) return false;

        // Must start with letter or underscore
        if (!/^[a-zA-Z_]/.test(name)) return false;

        // Must only contain valid chars
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return false;

        // Classes should start with uppercase
        if (type === 'class' && !/^[A-Z]/.test(name)) return false;

        // Variables/functions should start with lowercase
        if ((type === 'variable' || type === 'function') && /^[A-Z]/.test(name)) return false;

        // Reject common garbage outputs
        const blacklist = ['the', 'a', 'an', 'this', 'that', 'name', 'better', 'new', 'old'];
        if (blacklist.includes(name.toLowerCase())) return false;

        return true;
    }

    /**
     * Find the most agreed-upon suggestion
     */
    private findConsensus(suggestions: string[]): { bestName: string | null; agreementRatio: number } {
        if (suggestions.length === 0) {
            return { bestName: null, agreementRatio: 0 };
        }

        // Count occurrences
        const counts = new Map<string, number>();
        for (const s of suggestions) {
            counts.set(s, (counts.get(s) || 0) + 1);
        }

        // Find max
        let bestName = '';
        let maxCount = 0;
        for (const [name, count] of counts) {
            if (count > maxCount) {
                maxCount = count;
                bestName = name;
            }
        }

        return {
            bestName,
            agreementRatio: maxCount / this.config.consistencyChecks,
        };
    }

    /**
     * Calculate confidence based on multiple factors
     */
    private calculateConfidence(
        identifier: Identifier,
        suggestion: string,
        agreementRatio: number
    ): number {
        let confidence = agreementRatio;

        // Boost if original was very short/cryptic
        if (identifier.name.length <= 2) {
            confidence += 0.1;
        }

        // Reduce if suggestion is too similar to original
        if (suggestion.toLowerCase().includes(identifier.name.toLowerCase())) {
            confidence -= 0.1;
        }

        // Reduce if suggestion is too long
        if (suggestion.length > 25) {
            confidence -= 0.2;
        }

        // Boost if suggestion is in reasonable length range
        if (suggestion.length >= 5 && suggestion.length <= 20) {
            confidence += 0.05;
        }

        return Math.max(0, Math.min(1, confidence));
    }

    /**
     * Format name according to type conventions
     */
    private formatName(name: string, type: string): string {
        // Split into words
        const words = name
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/[_-]/g, ' ')
            .toLowerCase()
            .split(' ')
            .filter(w => w.length > 0);

        if (type === 'class') {
            // PascalCase
            return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
        } else {
            // camelCase
            return words
                .map((w, i) => i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))
                .join('');
        }
    }

    /**
     * Generate a simple reason for the rename
     */
    private async generateReason(identifier: Identifier, newName: string): Promise<string> {
        if (identifier.name.length <= 2) {
            return `Expanded cryptic name '${identifier.name}' to descriptive '${newName}'`;
        }
        if (identifier.name.length < newName.length) {
            return `Made name more descriptive: '${identifier.name}' → '${newName}'`;
        }
        return `Improved clarity: '${identifier.name}' → '${newName}'`;
    }
}
