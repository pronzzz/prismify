/**
 * Watch Mode
 * 
 * Watches files for changes and runs beautification automatically.
 */

import { watch, FSWatcher } from 'fs';
import { resolve, extname } from 'path';
import chalk from 'chalk';

const SUPPORTED_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.py', '.java']);

export interface WatchOptions {
    /** Path to watch (file or directory) */
    path: string;

    /** Callback to run on file change */
    onFileChange: (filePath: string) => Promise<void>;

    /** Debounce delay in ms */
    debounceMs?: number;

    /** Verbose output */
    verbose?: boolean;
}

/**
 * Start watching a file or directory
 */
export function startWatcher(options: WatchOptions): { stop: () => void } {
    const { path: watchPath, onFileChange, debounceMs = 300, verbose = false } = options;
    const resolvedPath = resolve(watchPath);

    // Debounce tracker
    const pending = new Map<string, NodeJS.Timeout>();

    if (verbose) {
        console.log(chalk.gray(`Watching: ${resolvedPath}`));
    }

    const watcher: FSWatcher = watch(
        resolvedPath,
        { recursive: true },
        (eventType, filename) => {
            if (!filename) return;

            const ext = extname(filename);
            if (!SUPPORTED_EXTENSIONS.has(ext)) return;

            const fullPath = resolve(resolvedPath, filename);

            // Debounce
            if (pending.has(fullPath)) {
                clearTimeout(pending.get(fullPath)!);
            }

            pending.set(fullPath, setTimeout(async () => {
                pending.delete(fullPath);

                if (verbose) {
                    console.log(chalk.gray(`Change detected: ${filename}`));
                }

                try {
                    await onFileChange(fullPath);
                } catch (error: any) {
                    console.error(chalk.red(`Error processing ${filename}: ${error.message}`));
                }
            }, debounceMs));
        }
    );

    console.log(chalk.green(`✓ Watching for changes... (Ctrl+C to stop)`));

    return {
        stop: () => {
            watcher.close();
            pending.forEach(t => clearTimeout(t));
            pending.clear();
        },
    };
}
