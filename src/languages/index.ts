/**
 * Language plugin registry.
 */

import { extname } from 'node:path';
import type { LanguagePlugin, SupportedLanguage } from '../types/index.js';
import { JavaScriptPlugin } from './javascript.js';
import { PythonPlugin } from './python.js';
import { JavaPlugin } from './java.js';

const EXTENSIONS: Record<string, SupportedLanguage> = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.mts': 'typescript',
    '.cts': 'typescript',
    '.py': 'python',
    '.pyw': 'python',
    '.pyi': 'python',
    '.java': 'java',
};

const cache = new Map<string, LanguagePlugin>();

/** Get the plugin for a language. `filePath` picks JSX/TSX parsing where relevant. */
export function getPlugin(language: SupportedLanguage, filePath = ''): LanguagePlugin {
    const ext = extname(filePath).toLowerCase();
    const key = language === 'typescript' ? `ts:${ext === '.tsx'}` : language === 'javascript' ? 'js' : language;
    let plugin = cache.get(key);
    if (!plugin) {
        switch (language) {
            case 'javascript':
                plugin = new JavaScriptPlugin({ typescript: false, jsx: true });
                break;
            case 'typescript':
                plugin = new JavaScriptPlugin({ typescript: true, jsx: ext === '.tsx' });
                break;
            case 'python':
                plugin = new PythonPlugin();
                break;
            case 'java':
                plugin = new JavaPlugin();
                break;
            default:
                throw new Error(`No plugin for language: ${language}`);
        }
        cache.set(key, plugin);
    }
    return plugin;
}

/** Detect the language from a file's extension. */
export function detectLanguage(filePath: string): SupportedLanguage | null {
    return EXTENSIONS[extname(filePath).toLowerCase()] ?? null;
}

export function supportedExtensions(): string[] {
    return Object.keys(EXTENSIONS);
}

/** Parse a user-supplied language name (`js`, `ts`, `py`, …). */
export function parseLanguage(input: string): SupportedLanguage | null {
    const v = input.toLowerCase();
    if (['js', 'javascript', 'jsx', 'node'].includes(v)) return 'javascript';
    if (['ts', 'typescript', 'tsx'].includes(v)) return 'typescript';
    if (['py', 'python', 'python3'].includes(v)) return 'python';
    if (['java'].includes(v)) return 'java';
    return null;
}

export { JavaScriptPlugin } from './javascript.js';
export { PythonPlugin } from './python.js';
export { JavaPlugin } from './java.js';
