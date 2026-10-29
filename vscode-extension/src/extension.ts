/**
 * Prismify for VS Code.
 *
 * Sends the editor's text to the Prismify CLI over stdin
 * (`prismify - --json --stdin-filepath <file>`) and applies the result as a
 * normal edit, so it can be undone with Cmd/Ctrl+Z. The file is never written
 * behind the editor's back.
 */

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const LANGUAGES = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'python', 'java'];

interface CliResult {
    changed: boolean;
    error: string | null;
    output: string;
    renames: { from: string; to: string; line: number; reason: string }[];
    docs: { target: string; line: number; text: string }[];
    suggestions: { title: string; explanation: string; refactored: string; lineRange: [number, number] }[];
    deadCode: { start: number; end: number; reason: string }[];
    warnings: string[];
}

let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    output = vscode.window.createOutputChannel('Prismify');

    context.subscriptions.push(
        output,
        vscode.commands.registerCommand('prismify.beautify', () => runOnEditor([])),
        vscode.commands.registerCommand('prismify.format', () => runOnEditor(['--no-rename'])),
        vscode.commands.registerCommand('prismify.explain', () =>
            runOnEditor(['--explain', '--explain-level', config().get<string>('explainLevel', 'production')])),
        vscode.commands.registerCommand('prismify.analyze', analyzeEditor),
        vscode.workspace.onWillSaveTextDocument(event => {
            if (!config(event.document).get<boolean>('formatOnSave')) return;
            if (!LANGUAGES.includes(event.document.languageId)) return;
            if (event.reason !== vscode.TextDocumentSaveReason.Manual) return;
            event.waitUntil(editsFor(event.document, ['--no-rename']).catch(() => []));
        }),
    );
}

export function deactivate() {}

function config(document?: vscode.TextDocument) {
    return vscode.workspace.getConfiguration('prismify', document?.uri);
}

/** Flags shared by every command, from the user's settings. */
function baseArgs(document: vscode.TextDocument): string[] {
    const c = config(document);
    const args = ['-', '--json', '--stdin-filepath', document.fileName];
    const style = c.get<string>('styleProfile', '');
    if (style) args.push('--style', style);
    if (c.get<boolean>('detectStyle')) args.push('--detect-style');
    args.push('--provider', c.get<string>('provider', 'auto'));
    const model = c.get<string>('model', '');
    if (model) args.push('--model', model);
    return args;
}

/** Find the CLI: the `prismify.path` setting, then the workspace's node_modules, then PATH. */
function cliCommand(document: vscode.TextDocument): string {
    const configured = config(document).get<string>('path', '');
    if (configured) return configured;
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (folder) {
        const local = path.join(folder.uri.fsPath, 'node_modules', '.bin', process.platform === 'win32' ? 'prismify.cmd' : 'prismify');
        if (fs.existsSync(local)) return local;
    }
    return 'prismify';
}

function runCli(document: vscode.TextDocument, extra: string[]): Promise<CliResult> {
    const command = cliCommand(document);
    const args = [...baseArgs(document), ...extra];
    const cwd = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? path.dirname(document.fileName);

    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, shell: process.platform === 'win32', env: { ...process.env, NO_COLOR: '1' } });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', d => (stdout += d));
        child.stderr.on('data', d => (stderr += d));
        child.on('error', (error: NodeJS.ErrnoException) => {
            reject(new Error(error.code === 'ENOENT'
                ? `Could not find the Prismify CLI ("${command}"). Install it with \`npm install -g github:pronzzz/prismify\` or set "prismify.path".`
                : error.message));
        });
        child.on('close', () => {
            if (stderr.trim()) output.appendLine(stderr.trim());
            try {
                const [result] = JSON.parse(stdout) as CliResult[];
                resolve(result);
            } catch {
                reject(new Error(stderr.trim() || 'Prismify returned no output.'));
            }
        });
        child.stdin.end(document.getText());
    });
}

async function editsFor(document: vscode.TextDocument, extra: string[]): Promise<vscode.TextEdit[]> {
    const result = await runCli(document, extra);
    if (result.error) throw new Error(result.error);
    if (!result.changed || result.output === document.getText()) return [];
    const all = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    return [vscode.TextEdit.replace(all, result.output)];
}

async function runOnEditor(extra: string[]) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const document = editor.document;
    const before = document.version;

    try {
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'Prismify' },
            () => runCli(document, extra),
        );
        if (result.error) {
            vscode.window.showErrorMessage(`Prismify: ${result.error}`);
            return;
        }
        report(document, result);
        if (!result.changed) {
            vscode.window.setStatusBarMessage('Prismify: already clean', 3000);
            return;
        }
        if (document.version !== before) {
            vscode.window.showWarningMessage('Prismify: the file changed while it was running. Try again.');
            return;
        }
        const all = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
        await editor.edit(edit => edit.replace(all, result.output));

        const parts: string[] = [];
        if (result.renames.length) parts.push(`${result.renames.length} rename${result.renames.length > 1 ? 's' : ''}`);
        if (result.docs.length) parts.push(`${result.docs.length} doc comment${result.docs.length > 1 ? 's' : ''}`);
        vscode.window.setStatusBarMessage(`Prismify: ${parts.length ? parts.join(', ') : 'formatted'}`, 4000);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Prismify: ${error.message}`);
    }
}

/** Show refactoring suggestions and dead code without changing the file. */
async function analyzeEditor() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    try {
        const result = await runCli(editor.document, ['--refactor', '--dead-code', '--no-rename', '--no-format']);
        if (result.error) {
            vscode.window.showErrorMessage(`Prismify: ${result.error}`);
            return;
        }
        report(editor.document, result);
        output.show(true);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Prismify: ${error.message}`);
    }
}

function report(document: vscode.TextDocument, r: CliResult) {
    output.appendLine(`\n${vscode.workspace.asRelativePath(document.uri)}`);
    for (const x of r.renames) output.appendLine(`  renamed ${x.from} → ${x.to} (line ${x.line}: ${x.reason})`);
    for (const d of r.docs) output.appendLine(`  documented ${d.target} (line ${d.line})`);
    r.suggestions.forEach((s, i) => {
        output.appendLine(`  ${i + 1}. ${s.title} (lines ${s.lineRange[0]}–${s.lineRange[1]})`);
        output.appendLine(`     ${s.explanation}`);
        if (s.refactored) output.appendLine(s.refactored.split('\n').map(l => `     │ ${l}`).join('\n'));
    });
    for (const d of r.deadCode) output.appendLine(`  line ${d.start}: ${d.reason}`);
    for (const w of r.warnings) output.appendLine(`  ⚠ ${w}`);
}
