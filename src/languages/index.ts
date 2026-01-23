/**
 * Language Plugins Index
 * 
 * Factory for creating language-specific plugins.
 */

import type { LanguagePlugin, SupportedLanguage } from '../types/index.js';
import { JavaScriptPlugin } from './javascript.js';
import { PythonPlugin } from './python.js';
import { JavaPlugin } from './java.js';

/**
 * Map of language identifiers to plugins
 */
const plugins: Map<SupportedLanguage, LanguagePlugin> = new Map();

/**
 * Initialize plugins lazily
 */
function ensurePlugins() {
    if (plugins.size === 0) {
        const js = new JavaScriptPlugin();
        plugins.set('javascript', js);
        plugins.set('typescript', js); // Same plugin handles both
        plugins.set('python', new PythonPlugin());
        plugins.set('java', new JavaPlugin());
    }
}

/**
 * Get a plugin for a specific language
 */
export function getPlugin(language: SupportedLanguage): LanguagePlugin {
    ensurePlugins();
    const plugin = plugins.get(language);
    if (!plugin) {
        throw new Error(`No plugin available for language: ${language}`);
    }
    return plugin;
}

/**
 * Auto-detect language from file extension
 */
export function detectLanguage(filePath: string): SupportedLanguage | null {
    const ext = filePath.toLowerCase().split('.').pop();

    switch (ext) {
        case 'js':
        case 'jsx':
        case 'mjs':
        case 'cjs':
            return 'javascript';
        case 'ts':
        case 'tsx':
            return 'typescript';
        case 'py':
        case 'pyw':
            return 'python';
        case 'java':
            return 'java';
        default:
            return null;
    }
}

/**
 * Get all supported file extensions
 */
export function getSupportedExtensions(): string[] {
    ensurePlugins();
    const extensions: string[] = [];
    for (const plugin of plugins.values()) {
        extensions.push(...plugin.extensions);
    }
    return [...new Set(extensions)];
}

export { JavaScriptPlugin } from './javascript.js';
export { PythonPlugin } from './python.js';
export { JavaPlugin } from './java.js';
