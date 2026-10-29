/**
 * Watch mode: re-run Prismify when supported files change.
 */

import { watch, type FSWatcher, statSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { detectLanguage } from '../languages/index.js';
import { DEFAULT_IGNORES, globToRegex } from '../core/files.js';

export interface WatchOptions {
    path: string;
    onFileChange: (filePath: string) => Promise<void>;
    debounceMs?: number;
    ignore?: string[];
}

export function startWatcher(options: WatchOptions): { stop: () => void } {
    const { onFileChange, debounceMs = 300 } = options;
    const root = resolve(options.path);
    const isFile = statSync(root).isFile();
    const watchRoot = isFile ? dirname(root) : root;
    const matchers = [...DEFAULT_IGNORES, ...(options.ignore ?? [])].map(globToRegex);
    const pending = new Map<string, NodeJS.Timeout>();
    let running = Promise.resolve();

    const watcher: FSWatcher = watch(watchRoot, { recursive: !isFile }, (_event, filename) => {
        if (!filename) return;
        const full = join(watchRoot, filename.toString());
        if (isFile && full !== root) return;
        if (!detectLanguage(full)) return;
        const parts = filename.toString().split(/[\\/]/);
        if (matchers.some(re => parts.some(p => re.test(p)) || re.test(basename(full)))) return;

        clearTimeout(pending.get(full));
        pending.set(full, setTimeout(() => {
            pending.delete(full);
            // Run one file at a time so output doesn't interleave.
            running = running.then(() => onFileChange(full)).catch(() => undefined);
        }, debounceMs));
    });

    return {
        stop: () => {
            watcher.close();
            pending.forEach(t => clearTimeout(t));
            pending.clear();
        },
    };
}
