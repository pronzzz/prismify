/**
 * Documentation comments for undocumented functions.
 *
 * Functions that already have a comment are skipped, so running Prismify
 * twice never stacks comments.
 */

import type {
    AIProvider,
    ExplainLevel,
    Explanation,
    LanguagePlugin,
    ProviderContext,
} from '../types/index.js';
import { HeuristicProvider, traitNotes } from '../ai/heuristic.js';

export async function generateDocs(
    code: string,
    plugin: LanguagePlugin,
    provider: AIProvider,
    level: ExplainLevel,
    ctx: ProviderContext
): Promise<{ code: string; docs: Explanation[]; warnings: string[] }> {
    const fns = plugin.extractFunctions(code).filter(f => !f.hasDoc);
    if (fns.length === 0) return { code, docs: [], warnings: [] };

    const summaries = await provider.summarizeFunctions(fns, level, ctx);
    const warnings = (provider as { drainWarnings?: () => string[] }).drainWarnings?.() ?? [];
    const fallback = provider.name === 'heuristic' ? null : new HeuristicProvider();
    const missing = fns.filter(f => !summaries.has(f.id));
    const heuristic = fallback && missing.length ? await fallback.summarizeFunctions(missing, level) : new Map<string, string>();

    const docs: Explanation[] = [];
    const inserts: Array<{ fn: (typeof fns)[number]; text: string }> = [];
    for (const fn of fns) {
        const fromAi = summaries.get(fn.id);
        let summary = fromAi ?? heuristic.get(fn.id);
        if (!summary) continue;
        const source: Explanation['source'] = fromAi && provider.name !== 'heuristic' ? 'ai' : 'heuristic';
        // AI summaries describe behaviour; add the same trait notes heuristics use when the model gave none.
        if (source === 'ai' && level !== 'production' && !summary.includes('\n')) {
            const notes = traitNotes(fn, level);
            if (notes.length) summary = [summary, ...notes].join('\n');
        }
        inserts.push({ fn, text: summary });
        docs.push({ target: fn.name, line: fn.line, text: summary, source });
    }
    return { code: plugin.insertDocs(code, inserts), docs, warnings };
}

export type { ExplainLevel };
