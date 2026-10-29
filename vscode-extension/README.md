# Prismify for VS Code

Runs the [Prismify](https://github.com/pronzzz/prismify) CLI on the current file and applies the result as a normal, undoable edit.

## Setup

1. Install the CLI: `npm install -g https://github.com/pronzzz/prismify/releases/latest/download/prismify.tgz` (or add it to your project's devDependencies).
2. Build and install the extension:
   ```bash
   cd vscode-extension
   npm install
   npx @vscode/vsce package
   code --install-extension prismify-2.0.0.vsix
   ```

## Commands

| Command | What it does |
| --- | --- |
| Prismify: Beautify File | Safe renames + formatting |
| Prismify: Format File | Formatting only |
| Prismify: Add Doc Comments | Adds doc comments to undocumented functions |
| Prismify: Show Refactoring Suggestions | Lists magic numbers, deep nesting and dead code in the Prismify output panel |

## Settings

`prismify.path`, `prismify.styleProfile`, `prismify.detectStyle`, `prismify.provider`, `prismify.model`, `prismify.explainLevel`, `prismify.formatOnSave`. Settings in a `.prismifyrc.json` are picked up too.
