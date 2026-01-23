/**
 * Pre-commit Hook Integration
 * 
 * Installs a git pre-commit hook that runs Prismify on staged files.
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Pre-commit hook script content
 */
const HOOK_SCRIPT = `#!/bin/sh
# Prismify pre-commit hook
# Auto-beautifies staged files before commit

echo "🔮 Running Prismify on staged files..."

# Get staged files for supported languages
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\\.(js|jsx|ts|tsx|py|java)$')

if [ -z "$STAGED_FILES" ]; then
  echo "No supported files staged"
  exit 0
fi

# Run prismify on each file
for FILE in $STAGED_FILES; do
  if [ -f "$FILE" ]; then
    echo "  Beautifying: $FILE"
    npx prismify "$FILE" --no-preview 2>/dev/null
    if [ $? -ne 0 ]; then
      echo "  ⚠ Warning: Failed to beautify $FILE"
    else
      git add "$FILE"
    fi
  fi
done

echo "✓ Prismify complete"
exit 0
`;

/**
 * Install the pre-commit hook
 */
export function installPreCommitHook(repoPath: string = '.'): { success: boolean; message: string } {
    const gitDir = join(repoPath, '.git');
    const hooksDir = join(gitDir, 'hooks');
    const hookPath = join(hooksDir, 'pre-commit');

    // Check if .git exists
    if (!existsSync(gitDir)) {
        return {
            success: false,
            message: 'Not a git repository. Run "git init" first.',
        };
    }

    // Create hooks directory if needed
    if (!existsSync(hooksDir)) {
        mkdirSync(hooksDir, { recursive: true });
    }

    // Check for existing hook
    if (existsSync(hookPath)) {
        const existing = readFileSync(hookPath, 'utf-8');
        if (existing.includes('Prismify')) {
            return {
                success: true,
                message: 'Prismify hook already installed.',
            };
        }
        // Backup existing hook
        writeFileSync(`${hookPath}.backup`, existing);
    }

    // Write hook
    writeFileSync(hookPath, HOOK_SCRIPT);
    chmodSync(hookPath, '755');

    return {
        success: true,
        message: `Pre-commit hook installed at ${hookPath}`,
    };
}

/**
 * Uninstall the pre-commit hook
 */
export function uninstallPreCommitHook(repoPath: string = '.'): { success: boolean; message: string } {
    const hookPath = join(repoPath, '.git', 'hooks', 'pre-commit');
    const backupPath = `${hookPath}.backup`;

    if (!existsSync(hookPath)) {
        return {
            success: true,
            message: 'No pre-commit hook to remove.',
        };
    }

    const content = readFileSync(hookPath, 'utf-8');
    if (!content.includes('Prismify')) {
        return {
            success: false,
            message: 'Pre-commit hook is not a Prismify hook.',
        };
    }

    // Restore backup if exists
    if (existsSync(backupPath)) {
        const backup = readFileSync(backupPath, 'utf-8');
        writeFileSync(hookPath, backup);
        return {
            success: true,
            message: 'Prismify hook removed, original hook restored.',
        };
    }

    // Just remove the file
    require('fs').unlinkSync(hookPath);
    return {
        success: true,
        message: 'Prismify hook removed.',
    };
}
