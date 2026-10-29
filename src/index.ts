/**
 * Prismify library API.
 *
 * ```ts
 * import { BeautifyEngine, getProfile, createProvider } from 'prismify';
 * const { provider } = await createProvider('auto');
 * const engine = new BeautifyEngine({ provider });
 * const result = await engine.beautify(code, 'file.js', { profile: getProfile('airbnb')! });
 * ```
 */

export * from './types/index.js';
export { BeautifyEngine, type EngineOptions } from './core/engine.js';
export { expandPaths, DEFAULT_IGNORES } from './core/files.js';
export { loadConfig, type PrismifyConfig } from './core/config.js';
export { createProvider, parseProvider, HeuristicProvider, OllamaProvider, type ProviderType } from './ai/index.js';
export { getPlugin, detectLanguage, parseLanguage, supportedExtensions } from './languages/index.js';
export { STYLE_PROFILES, getProfile, listProfiles, defaultProfileFor, detectStyle, type StyleProfile } from './styles/index.js';
export { analyzeForRefactoring } from './analysis/index.js';
export { generateDocs } from './explain/index.js';
export { unifiedDiff, renderDiff } from './output/diff.js';
export { installPreCommitHook, uninstallPreCommitHook, startWatcher } from './integration/index.js';
export { VERSION } from './version.js';
