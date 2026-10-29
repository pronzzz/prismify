/**
 * Ollama provider: naming and documentation from a local LLM.
 *
 * Guardrails against bad suggestions:
 *  - JSON-only responses, parsed defensively
 *  - all candidates of a file batched into one prompt with their code
 *  - the prompt is asked `checks` times; a name must win a majority to be used
 *  - every name is validated (syntax, keywords, length) before use, and the
 *    language plugin re-checks scope safety before applying it
 */

import { Ollama } from 'ollama';
import type {
    AIProvider,
    ExplainLevel,
    FunctionInfo,
    Identifier,
    NamingSuggestion,
    ProviderContext,
} from '../types/index.js';
import { conventionalName, isValidIdentifier } from '../core/naming.js';

export interface OllamaOptions {
    host?: string;
    model?: string;
    /** How many times to ask for names; a majority must agree. Default 3. */
    checks?: number;
    /** Milliseconds to wait when connecting. Default 2500. */
    connectTimeoutMs?: number;
}

export const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434';
const PREFERRED_MODELS = /coder|code|deepseek|qwen|starcoder|granite|codestral|codegemma/i;
const CHUNK = 12;

export class OllamaProvider implements AIProvider {
    name = 'ollama';
    label: string;
    private warnings: string[] = [];

    private constructor(
        private client: Ollama,
        readonly host: string,
        readonly model: string,
        private checks: number
    ) {
        this.label = `ollama (${model})`;
    }

    /** Connect and pick a model. Throws an Error with a helpful message on failure. */
    static async connect(opts: OllamaOptions = {}): Promise<OllamaProvider> {
        const host = opts.host || process.env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST;
        const normalizedHost = /^https?:\/\//.test(host) ? host : `http://${host}`;
        const client = new Ollama({ host: normalizedHost });
        let models: string[];
        try {
            const list = await withTimeout(client.list(), opts.connectTimeoutMs ?? 2500);
            models = list.models.map(m => m.name);
        } catch {
            throw new Error(`Ollama is not reachable at ${normalizedHost}. Start it with \`ollama serve\`.`);
        }
        const wanted = opts.model || process.env.OLLAMA_MODEL || process.env.PRISMIFY_MODEL;
        let model: string;
        if (wanted) {
            const match = models.find(m => m === wanted || m === `${wanted}:latest` || m.split(':')[0] === wanted);
            if (!match) throw new Error(`Model "${wanted}" is not installed in Ollama. Run \`ollama pull ${wanted}\`.`);
            model = match;
        } else {
            if (models.length === 0) throw new Error('Ollama has no models installed. Run `ollama pull qwen2.5-coder:7b`.');
            model = models.find(m => PREFERRED_MODELS.test(m)) ?? models[0];
        }
        return new OllamaProvider(client, normalizedHost, model, Math.max(1, opts.checks ?? 3));
    }

    /** Messages about failed requests since the last call. */
    drainWarnings(): string[] {
        const w = this.warnings;
        this.warnings = [];
        return w;
    }

    async suggestNames(candidates: Identifier[], ctx: ProviderContext): Promise<NamingSuggestion[]> {
        const out: NamingSuggestion[] = [];
        for (let i = 0; i < candidates.length; i += CHUNK) {
            const chunk = candidates.slice(i, i + CHUNK);
            const prompt = buildNamingPrompt(chunk, ctx);
            const runs: Array<Map<string, { name: string; confidence: number; reason: string }>> = [];
            for (let r = 0; r < this.checks; r++) {
                try {
                    const json = await this.generateJson(prompt, this.checks > 1 ? 0.3 : 0, 600);
                    runs.push(parseRenames(json));
                } catch (error: any) {
                    this.warnings.push(`Ollama naming request failed: ${error.message ?? error}`);
                    break;
                }
            }
            if (runs.length === 0) continue;

            for (const c of chunk) {
                const votes = new Map<string, { count: number; conf: number; reason: string }>();
                for (const run of runs) {
                    const s = run.get(c.id);
                    if (!s) continue;
                    const name = conventionalName(s.name, c.type, ctx.language);
                    if (!isValidIdentifier(name, ctx.language) || name === c.name) continue;
                    const v = votes.get(name) ?? { count: 0, conf: 0, reason: s.reason };
                    v.count++;
                    v.conf += clamp(s.confidence, 0, 1);
                    votes.set(name, v);
                }
                let best: [string, { count: number; conf: number; reason: string }] | undefined;
                for (const entry of votes) if (!best || entry[1].count > best[1].count) best = entry;
                if (!best) continue;
                const agreement = best[1].count / this.checks;
                if (agreement < 0.6) continue;
                const modelConfidence = best[1].conf / best[1].count;
                out.push({
                    id: c.id,
                    original: c.name,
                    suggested: best[0],
                    reason: best[1].reason || 'suggested by the model',
                    confidence: round2(agreement * modelConfidence),
                    source: 'ai',
                });
            }
        }
        return out;
    }

    async summarizeFunctions(fns: FunctionInfo[], level: ExplainLevel, ctx: ProviderContext): Promise<Map<string, string>> {
        const out = new Map<string, string>();
        for (let i = 0; i < fns.length; i += 6) {
            const chunk = fns.slice(i, i + 6);
            try {
                const json = await this.generateJson(buildDocPrompt(chunk, level, ctx), 0.2, 900);
                const docs = Array.isArray(json?.docs) ? json.docs : [];
                for (const d of docs) {
                    if (typeof d?.id !== 'string' || typeof d?.summary !== 'string') continue;
                    if (!chunk.some(f => f.id === d.id)) continue;
                    const summary = cleanSentence(d.summary);
                    if (!summary) continue;
                    const notes: string[] = Array.isArray(d.notes) ? d.notes.filter((n: unknown) => typeof n === 'string').map(cleanSentence).filter(Boolean) : [];
                    const lines = level === 'production' ? [summary] : [summary, ...notes.slice(0, level === 'beginner' ? 3 : 2)];
                    out.set(d.id, lines.join('\n'));
                }
            } catch (error: any) {
                this.warnings.push(`Ollama documentation request failed: ${error.message ?? error}`);
            }
        }
        return out;
    }

    private async generateJson(prompt: string, temperature: number, maxTokens: number): Promise<any> {
        const res = await this.client.generate({
            model: this.model,
            prompt,
            format: 'json',
            stream: false,
            options: { temperature, top_p: 0.9, num_predict: maxTokens },
        });
        return parseJsonLoose(res.response);
    }
}

// ── Prompts ──────────────────────────────────────────────────────────────

function buildNamingPrompt(cands: Identifier[], ctx: ProviderContext): string {
    const convention = ctx.language === 'python' ? 'snake_case' : 'camelCase';
    const snippets = new Map<string, string>();
    for (const c of cands) if (!snippets.has(c.context)) snippets.set(c.context, `S${snippets.size + 1}`);

    const items = cands.map(c => {
        const h = c.hints ?? {};
        const evidence = [
            h.initFrom && `assigned from \`${h.initFrom}\``,
            h.iterates && `iterates over \`${h.iterates}\``,
            h.role && `looks like a ${h.role}`,
            h.usedProperties?.length && `properties used: ${h.usedProperties.join(', ')}`,
        ].filter(Boolean).join('; ');
        return `- id: ${c.id} | current: ${c.name} | kind: ${c.type} | snippet: ${snippets.get(c.context)}${evidence ? ` | evidence: ${evidence}` : ''}`;
    });

    const code = [...snippets].map(([text, label]) => `### ${label}\n\`\`\`${ctx.language}\n${text}\n\`\`\``).join('\n\n');

    return `You rename cryptic local identifiers in ${ctx.language} code to clear, conventional names.

Rules:
- Reply with JSON only, in this shape: {"renames":[{"id":"<id>","name":"<new name>","confidence":0.0,"reason":"<under 12 words>"}]}
- Include every id listed below exactly once.
- Use ${convention} for variables, parameters and functions; PascalCase for classes.
- 2 to 30 characters, letters, digits and underscores only, never a language keyword or builtin.
- Base each name only on how the value is used in the snippet. Do not invent meaning.
- If the current name is already clear, or you are not sure, return the current name with confidence below 0.5.
- Do not reuse a name that already appears in the same snippet.

Identifiers:
${items.join('\n')}

Code:
${code}
`;
}

function buildDocPrompt(fns: FunctionInfo[], level: ExplainLevel, ctx: ProviderContext): string {
    const style: Record<ExplainLevel, string> = {
        production: '"summary": one sentence (max 18 words) saying what the function does. "notes": [].',
        'pr-review': '"summary": one sentence (max 18 words). "notes": up to 2 short sentences about side effects, edge cases or risks a reviewer should know. Empty if none.',
        beginner: '"summary": one plain-English sentence a beginner would understand. "notes": up to 3 short sentences explaining how it works.',
    };
    const blocks = fns.map(f => `### id: ${f.id}\n\`\`\`${ctx.language}\n${f.body}\n\`\`\``).join('\n\n');
    return `Write documentation comments for these ${ctx.language} functions.

Reply with JSON only: {"docs":[{"id":"<id>","summary":"...","notes":["..."]}]}
${style[level]}
Describe behaviour that is visible in the code. Do not guess about callers. No markdown, no code fences, do not repeat the function name as the first word.

${blocks}
`;
}

// ── Parsing ──────────────────────────────────────────────────────────────

export function parseJsonLoose(text: string): any {
    try {
        return JSON.parse(text);
    } catch {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(text.slice(start, end + 1));
            } catch {
                /* fall through */
            }
        }
        throw new Error('model returned invalid JSON');
    }
}

function parseRenames(json: any): Map<string, { name: string; confidence: number; reason: string }> {
    const out = new Map<string, { name: string; confidence: number; reason: string }>();
    const list = Array.isArray(json?.renames) ? json.renames : Array.isArray(json) ? json : [];
    for (const r of list) {
        if (typeof r?.id !== 'string' || typeof r?.name !== 'string') continue;
        const conf = typeof r.confidence === 'number' ? r.confidence : Number(r.confidence) || 0.5;
        out.set(r.id, { name: r.name.trim(), confidence: conf, reason: typeof r.reason === 'string' ? r.reason.trim() : '' });
    }
    return out;
}

function cleanSentence(s: string): string {
    const t = s.replace(/[`*]{3,}/g, '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    return /[.!?]$/.test(t) ? t : `${t}.`;
}

function clamp(n: number, lo: number, hi: number) {
    return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}

function round2(n: number) {
    return Math.round(n * 100) / 100;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        p.then(v => {
            clearTimeout(timer);
            resolve(v);
        }, e => {
            clearTimeout(timer);
            reject(e);
        });
    });
}
