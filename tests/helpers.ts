import { BeautifyEngine } from '../src/core/engine.js';
import { defaultProfileFor, getProfile } from '../src/styles/index.js';
import type { AIProvider, BeautifyOptions } from '../src/types/index.js';
import { detectLanguage } from '../src/languages/index.js';

export async function beautify(code: string, file: string, opts: Partial<BeautifyOptions> & { style?: string; provider?: AIProvider } = {}) {
    const engine = new BeautifyEngine({ provider: opts.provider, projectConfig: false });
    const language = detectLanguage(file)!;
    const profile = opts.style ? getProfile(opts.style)! : defaultProfileFor(language);
    return engine.beautify(code, file, { profile, ...opts });
}

export const renamesOf = (r: { renames: Array<{ from: string; to: string }> }) => r.renames.map(x => `${x.from}->${x.to}`);
