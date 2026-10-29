/**
 * Provider selection.
 */

import type { AIProvider } from '../types/index.js';
import { HeuristicProvider } from './heuristic.js';
import { OllamaProvider, type OllamaOptions } from './ollama.js';

export type ProviderType = 'auto' | 'ollama' | 'heuristic';

export function parseProvider(input: string): ProviderType | null {
    const v = input.toLowerCase();
    if (v === 'mock' || v === 'offline' || v === 'none') return 'heuristic';
    if (v === 'auto' || v === 'ollama' || v === 'heuristic') return v;
    return null;
}

/**
 * Create a provider.
 * - `heuristic`: offline rules only.
 * - `ollama`: requires a running Ollama; throws with a helpful message otherwise.
 * - `auto`: Ollama if reachable, otherwise heuristics (with a notice explaining why).
 */
export async function createProvider(
    type: ProviderType = 'auto',
    opts: OllamaOptions = {}
): Promise<{ provider: AIProvider; notice?: string }> {
    if (type === 'heuristic') return { provider: new HeuristicProvider() };
    if (type === 'ollama') return { provider: await OllamaProvider.connect(opts) };
    try {
        return { provider: await OllamaProvider.connect({ connectTimeoutMs: 1200, ...opts }) };
    } catch (error: any) {
        return { provider: new HeuristicProvider(), notice: `${error.message} Using offline heuristics.` };
    }
}

export { HeuristicProvider } from './heuristic.js';
export { OllamaProvider, DEFAULT_OLLAMA_HOST, type OllamaOptions } from './ollama.js';
