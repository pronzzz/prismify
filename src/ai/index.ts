/**
 * AI Provider Factory
 * 
 * Creates the appropriate AI provider based on availability and configuration.
 */

import type { AIProvider } from '../types/index.js';
import { OllamaProvider } from './ollama.js';
import { MockProvider } from './mock.js';

export type ProviderType = 'ollama' | 'mock' | 'auto';

/**
 * Create an AI provider
 * 
 * @param type - Provider type or 'auto' to auto-detect
 * @returns AI provider instance
 */
export async function createProvider(type: ProviderType = 'auto'): Promise<AIProvider> {
    if (type === 'mock') {
        return new MockProvider();
    }

    if (type === 'ollama') {
        const provider = new OllamaProvider();
        if (await provider.isAvailable()) {
            return provider;
        }
        throw new Error('Ollama is not available. Make sure Ollama is running (ollama serve)');
    }

    // Auto-detect: try Ollama first, fall back to mock
    if (type === 'auto') {
        const ollama = new OllamaProvider();
        if (await ollama.isAvailable()) {
            console.log('Using Ollama for AI-powered naming suggestions');
            return ollama;
        }
        console.log('Ollama not available, using heuristic naming (install Ollama for AI features)');
        return new MockProvider();
    }

    throw new Error(`Unknown provider type: ${type}`);
}

export { OllamaProvider } from './ollama.js';
export { MockProvider } from './mock.js';
