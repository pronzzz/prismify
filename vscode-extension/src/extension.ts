/**
 * Prismify VS Code Extension
 * 
 * AI-powered code beautification for VS Code.
 * 
 * Note: Run `npm install` in vscode-extension/ to install @types/vscode
 */

// @ts-ignore - vscode module is provided by VS Code runtime
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('Prismify extension activated');

    // Register beautify command
    const beautifyCommand = vscode.commands.registerCommand('prismify.beautify', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        const document = editor.document;
        const filePath = document.fileName;

        // Save the file first
        await document.save();

        // Get configuration
        const config = vscode.workspace.getConfiguration('prismify');
        const provider = config.get<string>('aiProvider') || 'auto';
        const style = config.get<string>('styleProfile') || 'airbnb';

        try {
            vscode.window.showInformationMessage('🔮 Prismify: Beautifying...');

            const { stdout, stderr } = await execAsync(
                `npx prismify "${filePath}" --style ${style} --provider ${provider}`
            );

            if (stderr) {
                console.error('Prismify warning:', stderr);
            }

            // Reload the document
            const uri = vscode.Uri.file(filePath);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);

            vscode.window.showInformationMessage('✓ Prismify: File beautified!');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Prismify error: ${error.message}`);
        }
    });

    // Register detect style command
    const detectStyleCommand = vscode.commands.registerCommand('prismify.detectStyle', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const filePath = editor.document.fileName;

        try {
            const { stdout } = await execAsync(
                `npx prismify "${filePath}" --detect-style --preview`
            );

            // Show output in a new panel
            const panel = vscode.window.createOutputChannel('Prismify Style Detection');
            panel.appendLine(stdout);
            panel.show();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error: ${error.message}`);
        }
    });

    // Register explain command
    const explainCommand = vscode.commands.registerCommand('prismify.explain', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const document = editor.document;
        const filePath = document.fileName;

        await document.save();

        const config = vscode.workspace.getConfiguration('prismify');
        const level = config.get<string>('explainLevel') || 'production';

        try {
            vscode.window.showInformationMessage('🔮 Prismify: Adding explanations...');

            await execAsync(
                `npx prismify "${filePath}" --explain --explain-level ${level}`
            );

            // Reload
            const uri = vscode.Uri.file(filePath);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);

            vscode.window.showInformationMessage('✓ Prismify: Explanations added!');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error: ${error.message}`);
        }
    });

    // Format on save
    const onSaveListener = vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
        const config = vscode.workspace.getConfiguration('prismify');
        if (!config.get<boolean>('formatOnSave')) return;
        if (!config.get<boolean>('enabled')) return;

        const lang = document.languageId;
        if (!['javascript', 'typescript', 'python', 'java'].includes(lang)) return;

        await vscode.commands.executeCommand('prismify.beautify');
    });

    context.subscriptions.push(
        beautifyCommand,
        detectStyleCommand,
        explainCommand,
        onSaveListener
    );
}

/**
 * Extension deactivation
 */
export function deactivate() {
    console.log('Prismify extension deactivated');
}
