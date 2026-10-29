/**
 * The beautification pipeline for a single file.
 *
 *   validate input → rename → re-validate → document → format → validate output
 *
 * If any step produces code that does not parse, that step is undone (or the
 * file is left untouched). Prismify never writes code it could not parse.
 */

import type {
    AIProvider,
    BeautifyOptions,
    BeautifyResult,
    CodeChange,
    Explanation,
    NamingSuggestion,
    SkippedRename,
    SupportedLanguage,
} from '../types/index.js';
import { detectLanguage, getPlugin } from '../languages/index.js';
import { HeuristicProvider } from '../ai/heuristic.js';
import { analyzeForRefactoring } from '../analysis/refactor.js';
import { generateDocs } from '../explain/docs.js';

export interface EngineOptions {
    provider?: AIProvider;
    /** Merge project formatter config (.prettierrc, pyproject.toml) over the profile. Default true. */
    projectConfig?: boolean;
}

export class BeautifyEngine {
    readonly provider: AIProvider;
    private heuristic = new HeuristicProvider();
    private projectConfig: boolean;

    constructor(options: EngineOptions = {}) {
        this.provider = options.provider ?? this.heuristic;
        this.projectConfig = options.projectConfig ?? true;
    }

    async beautify(code: string, filePath: string, options: BeautifyOptions): Promise<BeautifyResult> {
        const started = Date.now();
        const warnings: string[] = [];
        const language: SupportedLanguage | null = options.language ?? detectLanguage(filePath);
        const base = {
            filePath,
            original: code,
            beautified: code,
            changed: false,
            renames: [],
            skippedRenames: [] as SkippedRename[],
            docs: [] as Explanation[],
            suggestions: [],
            deadCode: [],
            changes: [] as CodeChange[],
            warnings,
        };
        const fail = (error: string, lang: SupportedLanguage = language ?? 'javascript'): BeautifyResult => ({
            ...base,
            language: lang,
            error,
            processingTime: Date.now() - started,
        });

        if (!language) return fail('unsupported file type');
        const plugin = getPlugin(language, filePath);
        const profile = options.profile;
        const ctx = { language, code, filePath };

        const input = await plugin.validate(code);
        if (!input.valid) return fail(`could not parse the file: ${input.error ?? 'syntax error'}`, language);
        if (!input.checked) warnings.push(`no ${language} parser found; output was not syntax-checked`);

        let current = code;
        const changes: CodeChange[] = [];
        let renames: BeautifyResult['renames'] = [];
        const skippedRenames: SkippedRename[] = [];

        // 1. Renames
        if (options.rename !== false && plugin.canRename) {
            const candidates = plugin.extractIdentifiers(current, { minNameLength: profile.minNameLength });
            if (candidates.length > 0) {
                let suggestions: NamingSuggestion[] = await this.provider.suggestNames(candidates, ctx);
                warnings.push(...((this.provider as { drainWarnings?: () => string[] }).drainWarnings?.() ?? []));
                if (this.provider !== this.heuristic) {
                    // Fill gaps the model left with evidence-based heuristics.
                    const covered = new Set(suggestions.map(s => s.id));
                    const rest = candidates.filter(c => !covered.has(c.id));
                    suggestions = suggestions.concat(await this.heuristic.suggestNames(rest, ctx));
                }
                const threshold = options.confidence ?? 0.7;
                const accepted: NamingSuggestion[] = [];
                for (const s of suggestions) {
                    const line = Number(s.id.split('@')[1]?.split(':')[0] ?? 0);
                    if (s.confidence < threshold) {
                        skippedRenames.push({ id: s.id, from: s.original, to: s.suggested, line, why: `low confidence (${Math.round(s.confidence * 100)}%)` });
                    } else if (s.suggested.length > profile.maxNameLength) {
                        skippedRenames.push({ id: s.id, from: s.original, to: s.suggested, line, why: `longer than ${profile.maxNameLength} characters` });
                    } else {
                        accepted.push(s);
                    }
                }
                if (accepted.length > 0) {
                    const result = plugin.applyRenames(current, accepted);
                    skippedRenames.push(...result.skipped);
                    if (result.applied.length > 0) {
                        const check = await plugin.validate(result.code);
                        if (check.valid) {
                            current = result.code;
                            renames = result.applied;
                            for (const r of renames) {
                                changes.push({ type: 'rename', line: r.line, summary: `${r.from} → ${r.to}` });
                            }
                        } else {
                            warnings.push(`renames were reverted because the result did not parse: ${check.error}`);
                        }
                    }
                }
            }
        }

        // 2. Documentation
        let docs: Explanation[] = [];
        if (options.explain) {
            const result = await generateDocs(current, plugin, this.provider, options.explainLevel ?? 'production', { ...ctx, code: current });
            warnings.push(...result.warnings);
            if (result.docs.length > 0) {
                const check = await plugin.validate(result.code);
                if (check.valid) {
                    current = result.code;
                    docs = result.docs;
                    for (const d of docs) changes.push({ type: 'docs', line: d.line, summary: `documented ${d.target}` });
                } else {
                    warnings.push(`documentation was skipped because the result did not parse: ${check.error}`);
                }
            }
        }

        // 3. Formatting
        if (options.format !== false) {
            try {
                const formatted = await plugin.format(current, { profile, filePath, projectConfig: this.projectConfig });
                if (formatted !== current) {
                    current = formatted;
                    changes.push({ type: 'format', summary: 'formatted' });
                }
            } catch (error: any) {
                warnings.push(`formatter failed: ${String(error.message ?? error).split('\n')[0]}`);
            }
        }

        // 4. Final safety check
        if (current !== code) {
            const output = await plugin.validate(current);
            if (!output.valid) {
                return fail(`Prismify produced code that does not parse, so the file was left unchanged (${output.error}). Please report this.`, language);
            }
        }

        // 5. Analysis (on the final code so line numbers match)
        const suggestions = options.refactor ? analyzeForRefactoring(current, plugin, { maxNestingDepth: profile.maxNestingDepth }) : [];
        const deadCode = options.deadCode ? plugin.findDeadCode(current) : [];

        return {
            ...base,
            language,
            beautified: current,
            changed: current !== code,
            renames,
            skippedRenames,
            docs,
            suggestions,
            deadCode,
            changes,
            processingTime: Date.now() - started,
        };
    }
}
