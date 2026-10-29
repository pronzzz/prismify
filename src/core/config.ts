/**
 * Project configuration: `.prismifyrc.json`, `.prismifyrc`, `prismify.config.json`,
 * or a `"prismify"` key in package.json — the nearest one above the working directory wins.
 * Command-line flags override the file.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ExplainLevel } from '../types/index.js';

export interface PrismifyConfig {
    style?: string;
    provider?: 'auto' | 'ollama' | 'heuristic';
    model?: string;
    ollamaHost?: string;
    /** How many times to ask the model for names (majority vote). */
    aiChecks?: number;
    /** Minimum confidence (0–1) for a rename to be applied. */
    confidence?: number;
    rename?: boolean;
    format?: boolean;
    explain?: boolean;
    explainLevel?: ExplainLevel;
    refactor?: boolean;
    deadCode?: boolean;
    /** Respect .prettierrc / pyproject.toml formatter settings. Default true. */
    projectConfig?: boolean;
    /** Extra ignore globs. */
    ignore?: string[];
}

export const CONFIG_FILES = ['.prismifyrc.json', '.prismifyrc', 'prismify.config.json'];

export function loadConfig(cwd = process.cwd()): { config: PrismifyConfig; path: string | null } {
    let dir = resolve(cwd);
    for (;;) {
        for (const name of CONFIG_FILES) {
            const p = join(dir, name);
            if (existsSync(p)) return { config: parse(readFileSync(p, 'utf8'), p), path: p };
        }
        const pkg = join(dir, 'package.json');
        if (existsSync(pkg)) {
            try {
                const json = JSON.parse(readFileSync(pkg, 'utf8'));
                if (json && typeof json.prismify === 'object') return { config: validate(json.prismify, pkg), path: pkg };
            } catch {
                /* ignore malformed package.json */
            }
        }
        const parent = dirname(dir);
        if (parent === dir) return { config: {}, path: null };
        dir = parent;
    }
}

function parse(text: string, path: string): PrismifyConfig {
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch (error: any) {
        throw new Error(`Invalid JSON in ${path}: ${error.message}`);
    }
    return validate(json, path);
}

function validate(json: any, path: string): PrismifyConfig {
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error(`${path}: config must be an object`);
    const known = new Set([
        'style', 'provider', 'model', 'ollamaHost', 'aiChecks', 'confidence', 'rename', 'format',
        'explain', 'explainLevel', 'refactor', 'deadCode', 'projectConfig', 'ignore', '$schema',
    ]);
    const unknown = Object.keys(json).filter(k => !known.has(k));
    if (unknown.length) throw new Error(`${path}: unknown option${unknown.length > 1 ? 's' : ''} ${unknown.map(k => `"${k}"`).join(', ')}`);
    if (json.ignore !== undefined && (!Array.isArray(json.ignore) || json.ignore.some((g: unknown) => typeof g !== 'string'))) {
        throw new Error(`${path}: "ignore" must be an array of strings`);
    }
    if (json.confidence !== undefined && !(typeof json.confidence === 'number' && json.confidence >= 0 && json.confidence <= 1)) {
        throw new Error(`${path}: "confidence" must be a number between 0 and 1`);
    }
    return json as PrismifyConfig;
}

export const DEFAULT_CONFIG_TEMPLATE: PrismifyConfig = {
    style: 'airbnb',
    provider: 'auto',
    confidence: 0.7,
    explainLevel: 'production',
    projectConfig: true,
    ignore: [],
};
