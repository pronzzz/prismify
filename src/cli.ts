#!/usr/bin/env node
/**
 * Prismify command-line interface.
 */

import { Command, Option } from 'commander';
import chalk from 'chalk';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as prettier from 'prettier';

import { VERSION } from './version.js';
import { BeautifyEngine } from './core/engine.js';
import { expandPaths, displayPath } from './core/files.js';
import { loadConfig, DEFAULT_CONFIG_TEMPLATE, type PrismifyConfig } from './core/config.js';
import { createProvider, parseProvider, DEFAULT_OLLAMA_HOST, OllamaProvider } from './ai/index.js';
import { detectLanguage, parseLanguage } from './languages/index.js';
import { detectPythonFormatter, pythonExecutable } from './languages/python.js';
import { defaultProfileFor, detectStyle, getProfile, listProfiles, STYLE_PROFILES, type StyleProfile } from './styles/index.js';
import { fileReport, statusLine, summaryLine } from './output/report.js';
import { unifiedDiff } from './output/diff.js';
import { installPreCommitHook, uninstallPreCommitHook, startWatcher, type HookMode } from './integration/index.js';
import { EXPLAIN_LEVELS, type AIProvider, type BeautifyResult, type ExplainLevel, type SupportedLanguage } from './types/index.js';

type Mode = 'write' | 'check' | 'preview';

interface CliOptions {
    write?: boolean;
    check?: boolean;
    stdout?: boolean;
    json?: boolean;
    diff?: boolean;
    style?: string;
    detectStyle?: boolean;
    listStyles?: boolean;
    provider?: string;
    model?: string;
    ollamaHost?: string;
    aiChecks?: string;
    confidence?: string;
    rename: boolean;
    format: boolean;
    explain?: boolean;
    explainLevel?: ExplainLevel;
    refactor?: boolean;
    deadCode?: boolean;
    language?: string;
    stdinFilepath?: string;
    projectConfig: boolean;
    verbose?: boolean;
    quiet?: boolean;
    color?: boolean;
}

class UsageError extends Error {}

// ── Options shared by the main command and `watch` ───────────────────────

function addBeautifyOptions(cmd: Command, { watch = false } = {}): Command {
    if (!watch) {
        cmd.option('-w, --write', 'write changes to disk (default: preview only)')
            .option('-c, --check', 'exit with code 1 if any file would change (for CI)')
            .option('--stdout', 'print the beautified code to stdout instead of a report')
            .option('--json', 'print machine-readable results')
            .option('--diff', 'always show diffs')
            .option('--no-diff', 'never show diffs')
            .addOption(new Option('-p, --preview', 'preview only (this is now the default)').hideHelp());
    }
    return cmd
        .option('-s, --style <profile>', `style profile: ${listProfiles().join(', ')}`)
        .option('--detect-style', "match the file's existing indentation, quotes and semicolons")
        .option('--provider <type>', 'naming provider: auto, ollama, heuristic (default: auto)')
        .option('--model <name>', 'Ollama model to use (default: best installed code model)')
        .option('--ollama-host <url>', `Ollama server (default: $OLLAMA_HOST or ${DEFAULT_OLLAMA_HOST})`)
        .option('--ai-checks <n>', 'ask the model n times; a majority must agree (default: 3)')
        .option('--confidence <0-1>', 'minimum confidence to apply a rename (default: 0.7)')
        .option('--no-rename', 'do not rename identifiers')
        .option('--no-format', 'do not run the formatter')
        .option('-e, --explain', 'add doc comments to undocumented functions')
        .addOption(new Option('--explain-level <level>', 'doc comment detail').choices(EXPLAIN_LEVELS))
        .option('-r, --refactor', 'suggest refactorings (magic numbers, deep nesting)')
        .option('-d, --dead-code', 'report unreachable and debug-only code')
        .option('-l, --language <lang>', 'force a language: js, ts, python, java')
        .option('--stdin-filepath <path>', 'path used to pick the language and config when reading stdin')
        .option('--no-project-config', 'ignore .prettierrc / pyproject.toml formatter settings')
        .option('-v, --verbose', 'show skipped renames and full suggestions')
        .option('-q, --quiet', 'only print errors and the summary');
}

const program = new Command();
program
    .name('prismify')
    .description('Make code easier to read: safe renames, formatting, doc comments and refactoring hints.')
    .version(VERSION, '-V, --version')
    .argument('[paths...]', 'files or directories to process (use - to read stdin)')
    .addHelpText('after', `
Examples:
  $ prismify src/app.js               preview changes for one file
  $ prismify src --write              update every supported file under src/
  $ prismify . --check --no-rename    CI: fail if formatting is needed
  $ prismify utils.py -e -r           add docstrings and show refactoring hints
  $ cat a.ts | prismify - -l ts       read stdin, print the result`);

addBeautifyOptions(program).option('--list-styles', 'list style profiles and exit').action(async (paths: string[], opts: CliOptions, cmd: Command) => {
    if (opts.listStyles) return printStyles();
    process.exitCode = await runBeautify(paths, opts, cmd);
});

// ── Main command ─────────────────────────────────────────────────────────

interface Resolved {
    config: PrismifyConfig;
    configPath: string | null;
    style?: string;
    explainLevel: ExplainLevel;
    confidence: number;
    rename: boolean;
    format: boolean;
    explain: boolean;
    refactor: boolean;
    deadCode: boolean;
    projectConfig: boolean;
    language?: SupportedLanguage;
}

/** Merge config-file values with flags; explicit flags win. */
function resolveOptions(opts: CliOptions, cmd: Command): Resolved {
    const { config, path: configPath } = loadConfig();
    const fromCli = (key: string) => cmd.getOptionValueSource(key) === 'cli';
    const bool = (key: keyof CliOptions & keyof PrismifyConfig, fallback: boolean) =>
        fromCli(key) ? Boolean(opts[key]) : (config[key] as boolean | undefined) ?? fallback;

    const style = opts.style ?? config.style;
    if (style && !getProfile(style)) throw new UsageError(`Unknown style "${style}". Available: ${listProfiles().join(', ')}`);

    const confidenceRaw = opts.confidence ?? config.confidence;
    const confidence = confidenceRaw === undefined ? 0.7 : Number(confidenceRaw);
    if (!(confidence >= 0 && confidence <= 1)) throw new UsageError('--confidence must be between 0 and 1');

    let language: SupportedLanguage | undefined;
    if (opts.language) {
        const parsed = parseLanguage(opts.language);
        if (!parsed) throw new UsageError(`Unknown language "${opts.language}". Use js, ts, python or java.`);
        language = parsed;
    }

    return {
        config,
        configPath,
        style,
        explainLevel: opts.explainLevel ?? config.explainLevel ?? 'production',
        confidence,
        rename: bool('rename', true),
        format: bool('format', true),
        explain: bool('explain', false),
        refactor: bool('refactor', false),
        deadCode: bool('deadCode', false),
        projectConfig: bool('projectConfig', true),
        language,
    };
}

async function makeProvider(opts: CliOptions, config: PrismifyConfig, rename: boolean, explain: boolean, log: (s: string) => void): Promise<AIProvider> {
    const type = parseProvider(opts.provider ?? config.provider ?? 'auto');
    if (!type) throw new UsageError(`Unknown provider "${opts.provider}". Use auto, ollama or heuristic.`);
    // No AI needed when we're only formatting.
    if (!rename && !explain) return (await createProvider('heuristic')).provider;
    const checks = opts.aiChecks ?? config.aiChecks;
    if (checks !== undefined && !(Number(checks) >= 1)) throw new UsageError('--ai-checks must be 1 or more');
    try {
        const { provider, notice } = await createProvider(type, {
            host: opts.ollamaHost ?? config.ollamaHost,
            model: opts.model ?? config.model,
            checks: checks === undefined ? undefined : Number(checks),
        });
        if (notice) log(chalk.dim(notice));
        else if (provider.name === 'ollama') log(chalk.dim(`Using ${provider.label}`));
        return provider;
    } catch (error: any) {
        throw new UsageError(error.message);
    }
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
}

function profileFor(r: Resolved, language: SupportedLanguage, code: string, detect: boolean): { profile: StyleProfile; detected?: ReturnType<typeof detectStyle> } {
    const base = r.style ? getProfile(r.style)! : defaultProfileFor(language);
    if (!detect) return { profile: base };
    const detected = detectStyle(code, language);
    return { profile: { ...base, ...detected.profile }, detected };
}

async function runBeautify(paths: string[], opts: CliOptions, cmd: Command): Promise<number> {
    const started = Date.now();
    const toStderr = !!opts.stdout || paths.includes('-') || !!opts.json;
    const say = (s: string) => (toStderr ? console.error : console.log)(s);
    const log = (s: string) => (opts.quiet && !s.includes('✖') ? undefined : say(s));

    let r: Resolved;
    let provider: AIProvider;
    try {
        r = resolveOptions(opts, cmd);
        if (paths.length === 0) {
            if (!process.stdin.isTTY) paths = ['-'];
            else {
                cmd.outputHelp();
                return 2;
            }
        }
        if (opts.write && opts.check) throw new UsageError('Use either --write or --check, not both.');
        provider = await makeProvider(opts, r.config, r.rename, r.explain, log);
    } catch (error: any) {
        console.error(chalk.red(`✖ ${error.message}`));
        return 2;
    }

    const engine = new BeautifyEngine({ provider, projectConfig: r.projectConfig });
    const mode: Mode = opts.check ? 'check' : opts.write ? 'write' : 'preview';
    const beautifyOpts = (profile: StyleProfile, language?: SupportedLanguage) => ({
        profile,
        language,
        rename: r.rename,
        format: r.format,
        explain: r.explain,
        explainLevel: r.explainLevel,
        refactor: r.refactor,
        deadCode: r.deadCode,
        confidence: r.confidence,
    });

    // stdin → stdout
    if (paths.length === 1 && paths[0] === '-') {
        const filePath = opts.stdinFilepath ? resolve(opts.stdinFilepath) : '';
        const language = r.language ?? (filePath ? detectLanguage(filePath) : null);
        if (!language) {
            console.error(chalk.red('✖ Reading stdin needs --language or --stdin-filepath.'));
            return 2;
        }
        const code = await readStdin();
        const { profile } = profileFor(r, language, code, !!opts.detectStyle);
        const result = await engine.beautify(code, filePath || `stdin.${language === 'python' ? 'py' : language === 'java' ? 'java' : language === 'typescript' ? 'ts' : 'js'}`, beautifyOpts(profile, language));
        if (opts.json) {
            console.log(JSON.stringify([{ ...toJson(result, 'stdin'), output: result.error ? code : result.beautified }], null, 2));
        } else {
            process.stdout.write(result.error ? code : result.beautified);
            if (result.error) console.error(chalk.red(`✖ ${result.error}`));
            else if (opts.verbose) console.error(fileReport({ ...result }, 'stdin', mode, { showDiff: false, verbose: true }));
        }
        if (result.error) return 1;
        return opts.check && result.changed ? 1 : 0;
    }

    const { files, missing, unsupported } = expandPaths(paths, r.config.ignore);
    for (const m of missing) console.error(chalk.red(`✖ ${m}: no such file or directory`));
    for (const u of unsupported) console.error(chalk.yellow(`⚠ ${u}: unsupported file type (skipped)`));
    if (files.length === 0) {
        if (!missing.length && !unsupported.length) console.error(chalk.yellow('No supported files found.'));
        return missing.length ? 2 : 0;
    }
    if (opts.stdout && files.length !== 1) {
        console.error(chalk.red('✖ --stdout works with a single file.'));
        return 2;
    }

    const results: BeautifyResult[] = [];
    const detailed = files.length <= 5 || !!opts.verbose;
    const showDiff = opts.diff === true || (cmd.getOptionValueSource('diff') !== 'cli' && detailed && mode !== 'write');

    for (const file of files) {
        const name = displayPath(file);
        let code: string;
        try {
            code = await readFile(file, 'utf8');
        } catch (error: any) {
            console.error(chalk.red(`✖ ${name}: ${error.message}`));
            continue;
        }
        const language = r.language ?? detectLanguage(file)!;
        const { profile, detected } = profileFor(r, language, code, !!opts.detectStyle);
        const result = await engine.beautify(code, file, beautifyOpts(profile, r.language));
        results.push(result);

        if (mode === 'write' && result.changed && !result.error) await writeFile(file, result.beautified, 'utf8');

        if (opts.stdout) {
            process.stdout.write(result.beautified);
            if (result.error) console.error(chalk.red(`✖ ${result.error}`));
            continue;
        }
        if (opts.json || opts.quiet) {
            if (opts.quiet && result.error) console.error(statusLine(result, name, mode));
            continue;
        }
        if (detected && detailed) {
            log(chalk.dim(`\n${name}: detected ${detected.patterns.map(p => `${p.name} ${p.detected}`).join(', ')}`));
        }
        log(detailed ? fileReport(result, name, mode, { showDiff, verbose: !!opts.verbose }) : statusLine(result, name, mode));
    }

    if (opts.json) {
        console.log(JSON.stringify(results.map(x => toJson(x, displayPath(x.filePath))), null, 2));
    } else if (!opts.stdout) {
        // The summary is printed even with --quiet.
        log('');
        say(summaryLine(results, mode, Date.now() - started));
        const pending = results.some(x => x.changed && !x.error);
        if (mode === 'preview' && pending) log(chalk.dim('Preview only. Run again with --write to apply.'));
        if (mode === 'check' && pending) say(chalk.yellow('Some files need changes. Run prismify --write to fix them.'));
    }

    if (results.some(x => x.error)) return 1;
    if (mode === 'check' && results.some(x => x.changed)) return 1;
    return 0;
}

function toJson(r: BeautifyResult, name: string) {
    return {
        file: name,
        language: r.language,
        changed: r.changed,
        error: r.error ?? null,
        renames: r.renames,
        skippedRenames: r.skippedRenames,
        docs: r.docs,
        suggestions: r.suggestions,
        deadCode: r.deadCode,
        warnings: r.warnings,
        diff: r.changed ? unifiedDiff(r.original, r.beautified, name) : '',
        processingTime: r.processingTime,
    };
}

// ── styles ───────────────────────────────────────────────────────────────

function printStyles() {
    console.log(chalk.bold('Style profiles\n'));
    for (const name of listProfiles()) {
        const p = STYLE_PROFILES[name];
        const naming = p.minNameLength <= 1 ? 'no length-based renames' : `rename names under ${p.minNameLength} chars`;
        console.log(`  ${chalk.cyan(name.padEnd(12))} ${p.description}`);
        console.log(chalk.dim(`  ${' '.repeat(12)} ${p.indentSize}${p.indentStyle === 'tabs' ? ' tabs' : ' spaces'} · ${p.quotes} quotes · ${p.semicolons ? 'semicolons' : 'no semicolons'} · width ${p.maxLineLength} · ${naming}`));
    }
    console.log(chalk.dim('\nDefault: airbnb for JS/TS, python for Python, java for Java.'));
}

program.command('styles').description('list style profiles').action(printStyles);

// ── doctor ───────────────────────────────────────────────────────────────

program
    .command('doctor')
    .description('check that Ollama, Python tooling and config are set up')
    .option('--ollama-host <url>', 'Ollama server to check')
    .option('--model <name>', 'model to look for')
    .action(async (opts: { ollamaHost?: string; model?: string }) => {
        const ok = chalk.green('✔');
        const warn = chalk.yellow('⚠');
        const bad = chalk.red('✖');
        const row = (icon: string, label: string, detail: string, hint?: string) => {
            console.log(`  ${icon} ${label.padEnd(18)} ${detail}`);
            if (hint) console.log(chalk.dim(`    ${' '.repeat(18)} ${hint}`));
        };
        console.log(chalk.bold(`\nPrismify ${VERSION}`) + chalk.dim(`  node ${process.version}\n`));

        let configPath: string | null = null;
        try {
            configPath = loadConfig().path;
            row(ok, 'Config', configPath ? displayPath(configPath) : chalk.dim('none (using defaults)'), configPath ? undefined : 'Create one with `prismify init`.');
        } catch (error: any) {
            row(bad, 'Config', error.message);
        }

        row(ok, 'JavaScript / TS', `Babel parser + Prettier ${prettier.version}`);
        row(ok, 'Java', `prettier-plugin-java ${packageVersion('prettier-plugin-java') ?? ''}`.trim());

        const py = pythonExecutable();
        if (py) {
            const v = spawnSync(py, ['--version'], { encoding: 'utf8' });
            row(ok, 'Python checks', `${py} (${(v.stdout || v.stderr).trim()})`);
        } else {
            row(warn, 'Python checks', 'python3 not found', 'Python output will not be syntax-checked. Install Python 3 or set PRISMIFY_PYTHON.');
        }
        const formatter = detectPythonFormatter();
        if (formatter === 'builtin') row(warn, 'Python formatter', 'built-in (whitespace only)', 'Install ruff (`pip install ruff`) or black for full PEP 8 formatting.');
        else row(ok, 'Python formatter', formatter);

        try {
            const provider = await OllamaProvider.connect({ host: opts.ollamaHost, model: opts.model, connectTimeoutMs: 2000 });
            row(ok, 'Ollama', `${provider.host} · model ${chalk.cyan(provider.model)}`);
        } catch (error: any) {
            row(warn, 'Ollama', error.message, 'Without Ollama, Prismify uses offline heuristics for renames and docs.');
        }
        console.log('');
    });

function packageVersion(name: string): string | null {
    try {
        const require = createRequire(import.meta.url);
        let dir = dirname(require.resolve(name));
        for (let i = 0; i < 5; i++) {
            const pkg = join(dir, 'package.json');
            if (existsSync(pkg)) {
                const json = require(pkg);
                if (json.name === name) return json.version;
            }
            dir = dirname(dir);
        }
    } catch {
        /* ignore */
    }
    return null;
}

// ── init ─────────────────────────────────────────────────────────────────

program
    .command('init')
    .description('create a .prismifyrc.json in the current directory')
    .option('-f, --force', 'overwrite an existing file')
    .action((opts: { force?: boolean }) => {
        const target = resolve('.prismifyrc.json');
        if (existsSync(target) && !opts.force) {
            console.error(chalk.red('✖ .prismifyrc.json already exists (use --force to overwrite).'));
            process.exitCode = 1;
            return;
        }
        writeFileSync(target, JSON.stringify(DEFAULT_CONFIG_TEMPLATE, null, 2) + '\n');
        console.log(`${chalk.green('✔')} Created .prismifyrc.json`);
    });

// ── watch ────────────────────────────────────────────────────────────────

addBeautifyOptions(
    program.command('watch').description('beautify files as they change (writes changes)').argument('<path>', 'file or directory to watch'),
    { watch: true }
).action(async (path: string, opts: CliOptions, cmd: Command) => {
    let r: Resolved;
    let provider: AIProvider;
    try {
        r = resolveOptions(opts, cmd);
        provider = await makeProvider(opts, r.config, r.rename, r.explain, console.log);
    } catch (error: any) {
        console.error(chalk.red(`✖ ${error.message}`));
        process.exitCode = 2;
        return;
    }
    if (!existsSync(path)) {
        console.error(chalk.red(`✖ ${path}: no such file or directory`));
        process.exitCode = 2;
        return;
    }
    const engine = new BeautifyEngine({ provider, projectConfig: r.projectConfig });
    const lastWritten = new Map<string, string>();

    startWatcher({
        path,
        ignore: r.config.ignore,
        onFileChange: async (file) => {
            let code: string;
            try {
                code = await readFile(file, 'utf8');
            } catch {
                return; // deleted
            }
            if (lastWritten.get(file) === code) return; // our own write
            const language = r.language ?? detectLanguage(file)!;
            const { profile } = profileFor(r, language, code, !!opts.detectStyle);
            const result = await engine.beautify(code, file, {
                profile,
                language: r.language,
                rename: r.rename,
                format: r.format,
                explain: r.explain,
                explainLevel: r.explainLevel,
                refactor: false,
                deadCode: false,
                confidence: r.confidence,
            });
            if (result.changed && !result.error) {
                lastWritten.set(file, result.beautified);
                await writeFile(file, result.beautified, 'utf8');
            }
            const time = chalk.dim(new Date().toLocaleTimeString());
            console.log(`${time} ${statusLine(result, displayPath(file), 'write')}`);
        },
    });
    console.log(`${chalk.green('✔')} Watching ${displayPath(resolve(path))} ${chalk.dim('(Ctrl+C to stop)')}`);
});

// ── hook ─────────────────────────────────────────────────────────────────

program
    .command('hook')
    .description('install or uninstall a git pre-commit hook')
    .argument('<action>', 'install or uninstall')
    .addOption(new Option('--mode <mode>', 'check blocks the commit; write fixes and re-stages').choices(['check', 'write']).default('check'))
    .option('--args <flags>', 'flags passed to prismify in the hook', '--no-rename')
    .action((action: string, opts: { mode: HookMode; args: string }) => {
        const res = action === 'install'
            ? installPreCommitHook('.', opts.mode, opts.args)
            : action === 'uninstall'
                ? uninstallPreCommitHook('.')
                : { success: false, message: `Unknown action "${action}". Use install or uninstall.` };
        console.log(res.success ? `${chalk.green('✔')} ${res.message}` : chalk.red(`✖ ${res.message}`));
        if (!res.success) process.exitCode = 1;
    });

program.parseAsync().catch((error: any) => {
    console.error(chalk.red(`✖ ${error?.message ?? error}`));
    if (process.env.PRISMIFY_DEBUG) console.error(error?.stack);
    process.exitCode = 1;
});
