#!/usr/bin/env node
/**
 * Prismify CLI
 * 
 * AI-powered code beautification that goes beyond syntax formatting.
 * 
 * Usage:
 *   npx prismify <file>              Beautify a file
 *   npx prismify <file> --preview    Preview changes without writing
 *   npx prismify <file> --refactor   Enable semantic refactoring
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { createEngine } from './core/index.js';
import { generateDiff, formatChangeList } from './output/index.js';
import { analyzeForRefactoring } from './analysis/index.js';
import { generateExplanations } from './explain/index.js';
import { detectStyle, getProfile, listProfiles } from './styles/index.js';
import type { BeautifyOptions, RefactorOptions, ExplainOptions, ExplainLevel } from './types/index.js';

const VERSION = '4.0.0';

const program = new Command();

program
    .name('prismify')
    .description(chalk.cyan('✨ AI-powered code beautification that goes beyond syntax formatting'))
    .version(VERSION)
    .argument('<file>', 'File to beautify')
    .option('-p, --preview', 'Preview changes without writing to file')
    .option('-l, --language <lang>', 'Specify language (js, ts, python, java)')
    .option('--no-ai', 'Skip AI-powered renaming, only format')
    .option('--no-format', 'Skip formatting, only rename')
    .option('-d, --dead-code', 'Flag dead/unreachable code')
    .option('-v, --verbose', 'Show detailed output')
    .option('--provider <type>', 'AI provider: ollama, mock, auto (default: auto)')
    // Phase 2: Refactoring options
    .option('-r, --refactor', 'Enable semantic refactoring analysis')
    .option('--simplify-conditionals', 'Simplify nested conditionals (requires --refactor)')
    .option('--name-constants', 'Convert magic numbers to constants (requires --refactor)')
    // Phase 3: Explainability options
    .option('-e, --explain', 'Add AI-generated explanatory comments')
    .option('--explain-level <level>', 'Comment detail: beginner, pr-review, production (default: production)')
    // Phase 4: Style profile options
    .option('-s, --style <profile>', `Style profile: ${listProfiles().join(', ')} (default: airbnb)`)
    .option('--detect-style', 'Auto-detect style from existing code')
    .option('--list-styles', 'List available style profiles')
    .action(async (file: string, opts: any) => {
        try {
            console.log(chalk.cyan('\n✨ Prismify - AI Code Beautifier\n'));

            // Resolve file path
            const filePath = resolve(file);

            // Read source file
            let source: string;
            try {
                source = await readFile(filePath, 'utf-8');
            } catch (err) {
                console.error(chalk.red(`Error: Cannot read file: ${filePath}`));
                process.exit(1);
            }

            if (opts.verbose) {
                console.log(chalk.gray(`Processing: ${filePath}`));
                console.log(chalk.gray(`Size: ${source.length} characters, ${source.split('\n').length} lines`));
            }

            // Phase 4: Style handling
            if (opts.listStyles) {
                console.log(chalk.cyan('Available style profiles:'));
                for (const name of listProfiles()) {
                    const profile = getProfile(name);
                    console.log(`  ${chalk.bold(name)}: ${profile?.description || ''}`);
                }
                process.exit(0);
            }

            // Get or detect style profile
            let activeProfile: any = getProfile(opts.style || 'airbnb');
            if (opts.detectStyle) {
                console.log(chalk.gray('Detecting code style...'));
                const ext = filePath.split('.').pop() || '';
                const lang = ext === 'py' ? 'python' : 'javascript';
                const detected = detectStyle(source, lang as any);

                console.log(chalk.cyan(`\n━━━ Detected Style (${Math.round(detected.confidence * 100)}% confidence) ━━━\n`));
                for (const pattern of detected.patterns) {
                    console.log(`  ${chalk.bold(pattern.name)}: ${pattern.detected} (${Math.round(pattern.confidence * 100)}%)`);
                }
                console.log('');

                activeProfile = { ...activeProfile, ...detected.profile };
            }

            if (opts.style && opts.verbose) {
                console.log(chalk.gray(`Using style profile: ${opts.style}`));
            }

            // Initialize engine
            const engine = await createEngine({
                aiProvider: opts.provider || 'auto',
            });

            // Build options
            const beautifyOpts: BeautifyOptions = {
                language: opts.language,
                aiRenaming: opts.ai !== false,
                removeDeadCode: opts.deadCode,
                preview: opts.preview,
            };

            // Run beautification
            console.log(chalk.gray('Analyzing code...'));
            const result = await engine.beautify(source, filePath, beautifyOpts);

            // Check for validation errors
            if (!result.isValid) {
                console.error(chalk.red(`\nValidation Error: ${result.validationError}`));
                console.log(chalk.yellow('Original code returned unchanged.'));
                process.exit(1);
            }

            // Phase 2: Refactoring analysis
            if (opts.refactor) {
                console.log(chalk.gray('Running refactoring analysis...'));

                const refactorOpts: RefactorOptions = {
                    simplifyConditionals: opts.simplifyConditionals !== false,
                    namedConstants: opts.nameConstants !== false,
                };

                const refactorResult = await analyzeForRefactoring(
                    result.beautified,
                    result.language,
                    refactorOpts
                );

                if (refactorResult.suggestions.length > 0) {
                    console.log(chalk.cyan(`\n━━━ Refactoring Suggestions (${refactorResult.suggestions.length}) ━━━\n`));

                    for (let i = 0; i < refactorResult.suggestions.length; i++) {
                        const s = refactorResult.suggestions[i];
                        const confidence = Math.round(s.confidence * 100);

                        console.log(chalk.bold(`${i + 1}. [${s.type}]`) + ` (${confidence}% confidence)`);
                        console.log(chalk.gray(`   Lines ${s.lineRange[0]}-${s.lineRange[1]}`));
                        console.log(chalk.white(`   ${s.explanation}`));

                        if (opts.verbose) {
                            console.log(chalk.red('\n   Before:'));
                            console.log(chalk.gray('   ' + s.original.split('\n').slice(0, 3).join('\n   ')));
                            console.log(chalk.green('\n   After:'));
                            console.log(chalk.gray('   ' + s.refactored.split('\n').slice(0, 3).join('\n   ')));
                        }
                        console.log('');
                    }

                    console.log(chalk.yellow('Note: Refactoring suggestions are not auto-applied.'));
                    console.log(chalk.yellow('Use --interactive mode in future versions to accept/reject.\n'));
                } else {
                    console.log(chalk.green('\n✓ No refactoring suggestions - code looks clean!'));
                }
            }

            // Phase 3: Explainability
            let finalCode = result.beautified;
            if (opts.explain) {
                console.log(chalk.gray('Generating explanations...'));

                const level: ExplainLevel = opts.explainLevel || 'production';
                const explainOpts: ExplainOptions = {
                    level,
                    fileSummary: true,
                    functionComments: true,
                    inlineComments: level === 'beginner',
                };

                const explainResult = await generateExplanations(
                    result.beautified,
                    result.language,
                    explainOpts
                );

                if (explainResult.explanations.length > 0) {
                    console.log(chalk.cyan(`\n━━━ Explanations Generated (${explainResult.explanations.length}) ━━━\n`));
                    console.log(chalk.gray(`  Mode: ${level}`));

                    for (const exp of explainResult.explanations) {
                        console.log(chalk.bold(`  [${exp.type}]`) + ` at line ${exp.line}`);
                        if (exp.targetName) {
                            console.log(chalk.gray(`    Target: ${exp.targetName}`));
                        }
                        if (opts.verbose) {
                            console.log(chalk.gray(`    ${exp.text.split('\n')[0].slice(0, 60)}...`));
                        }
                    }

                    finalCode = explainResult.explained;
                    console.log(chalk.green(`\n✓ Added ${explainResult.explanations.length} explanatory comments`));
                }
            }

            // Show results
            console.log(chalk.green(`\n✓ Beautification complete in ${result.processingTime}ms`));
            console.log(chalk.gray(`  Language: ${result.language}`));
            console.log(chalk.gray(`  Changes: ${result.changes.length}`));

            // Show diff if there are changes
            if (result.beautified !== result.original) {
                const diff = generateDiff(result.original, result.beautified, file);
                console.log(diff.terminal);

                if (opts.verbose) {
                    console.log(formatChangeList(result.changes));
                }

                // Write changes unless preview mode
                if (!opts.preview) {
                    await writeFile(filePath, result.beautified, 'utf-8');
                    console.log(chalk.green(`\n✓ File updated: ${filePath}`));
                } else {
                    console.log(chalk.yellow('\n⚠ Preview mode - no changes written'));
                }
            } else {
                console.log(chalk.yellow('\nNo changes needed - code is already clean!'));
            }

        } catch (error: any) {
            console.error(chalk.red(`\nError: ${error.message}`));
            if (opts.verbose) {
                console.error(error.stack);
            }
            process.exit(1);
        }
    });

// Parse CLI arguments
program.parse();
