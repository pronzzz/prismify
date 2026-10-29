/**
 * Style Detection
 * 
 * Analyzes code to detect existing style patterns.
 */

import type { StyleProfile, NamingConvention } from './profiles.js';

export interface DetectedStyle {
    /** Only the settings that were detected; merge these over a base profile. */
    profile: Partial<StyleProfile>;

    /** Confidence in detection (0-1) */
    confidence: number;

    /** Individual pattern detections */
    patterns: StylePattern[];
}

export interface StylePattern {
    name: string;
    detected: string;
    count: number;
    confidence: number;
}

/**
 * Detect the naming convention used for identifiers
 */
function detectNamingConvention(names: string[]): { convention: NamingConvention; confidence: number } {
    if (names.length === 0) {
        return { convention: 'camelCase', confidence: 0 };
    }

    let camelCase = 0;
    let snakeCase = 0;
    let pascalCase = 0;
    let screamingSnake = 0;

    for (const name of names) {
        if (/^[a-z][a-zA-Z0-9]*$/.test(name) && /[A-Z]/.test(name)) {
            camelCase++;
        } else if (/^[a-z][a-z0-9_]*$/.test(name) && name.includes('_')) {
            snakeCase++;
        } else if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
            pascalCase++;
        } else if (/^[A-Z][A-Z0-9_]*$/.test(name) && name.includes('_')) {
            screamingSnake++;
        } else if (/^[a-z][a-z0-9]*$/.test(name)) {
            // Simple lowercase - assume camelCase
            camelCase++;
        }
    }

    const total = names.length;
    const scores = [
        { convention: 'camelCase' as NamingConvention, count: camelCase },
        { convention: 'snake_case' as NamingConvention, count: snakeCase },
        { convention: 'PascalCase' as NamingConvention, count: pascalCase },
        { convention: 'SCREAMING_SNAKE' as NamingConvention, count: screamingSnake },
    ];

    scores.sort((a, b) => b.count - a.count);
    const winner = scores[0];

    return {
        convention: winner.convention,
        confidence: winner.count / total,
    };
}

/**
 * Extract variable names from JavaScript code
 */
function extractVariableNamesJS(code: string): string[] {
    const names: string[] = [];
    const patterns = [
        /(?:const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
        /function\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(code)) !== null) {
            names.push(match[1]);
        }
    }

    return names;
}

/**
 * Extract variable names from Python code
 */
function extractVariableNamesPython(code: string): string[] {
    const names: string[] = [];
    const patterns = [
        /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=/gm,
        /def\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(code)) !== null) {
            names.push(match[1]);
        }
    }

    return names;
}

/**
 * Detect indentation style
 */
function detectIndentation(code: string): { style: 'spaces' | 'tabs'; size: 2 | 4 } {
    const lines = code.split('\n');
    let spacesCount = 0;
    let tabsCount = 0;
    let twoSpaces = 0;
    let fourSpaces = 0;

    for (const line of lines) {
        if (line.startsWith('\t')) {
            tabsCount++;
        } else if (line.startsWith('  ')) {
            spacesCount++;
            const match = line.match(/^( +)/);
            if (match) {
                const len = match[1].length;
                if (len % 4 === 0) fourSpaces++;
                else if (len % 2 === 0) twoSpaces++;
            }
        }
    }

    return {
        style: tabsCount > spacesCount ? 'tabs' : 'spaces',
        size: fourSpaces > twoSpaces ? 4 : 2,
    };
}

/**
 * Detect quote style
 */
function detectQuotes(code: string): 'single' | 'double' {
    const singleCount = (code.match(/'[^'\n]*'/g) || []).length;
    const doubleCount = (code.match(/"[^"\n]*"/g) || []).length;
    return singleCount > doubleCount ? 'single' : 'double';
}

/**
 * Detect semicolon usage
 */
function detectSemicolons(code: string): boolean {
    // Only lines that end a statement: skip blank lines, comments, and lines that open or close blocks.
    const statements = code
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !/^(\/\/|\/\*|\*)/.test(l) && !/[{}(\[,]$/.test(l) && !/^[}\])]/.test(l));
    const withSemi = statements.filter(l => l.endsWith(';')).length;
    return withSemi > statements.length / 2;
}

/**
 * Detect early return pattern preference
 */
function detectEarlyReturns(code: string): boolean {
    const earlyReturns = (code.match(/if\s*\([^)]+\)\s*return/g) || []).length;
    const nestedIfs = (code.match(/if\s*\([^)]+\)\s*\{[^}]*if\s*\(/g) || []).length;
    return earlyReturns > nestedIfs;
}

/**
 * Analyze code and detect style patterns
 */
export function detectStyle(
    code: string,
    language: 'javascript' | 'typescript' | 'python' | 'java'
): DetectedStyle {
    const patterns: StylePattern[] = [];
    const profile: Partial<StyleProfile> = {};

    // Extract names
    const names = language === 'python'
        ? extractVariableNamesPython(code)
        : extractVariableNamesJS(code);

    // Detect naming convention
    const naming = detectNamingConvention(names);
    patterns.push({
        name: 'naming',
        detected: naming.convention,
        count: names.length,
        confidence: naming.confidence,
    });
    profile.variableNaming = naming.convention;
    profile.functionNaming = naming.convention;

    // Detect indentation
    const indent = detectIndentation(code);
    patterns.push({
        name: 'indentation',
        detected: `${indent.size} ${indent.style}`,
        count: code.split('\n').length,
        confidence: 0.9,
    });
    profile.indentStyle = indent.style;
    profile.indentSize = indent.size;

    // Detect quotes and semicolons (JS/TS only; Java syntax fixes both).
    if (language === 'javascript' || language === 'typescript') {
        const quotes = detectQuotes(code);
        patterns.push({
            name: 'quotes',
            detected: quotes,
            count: (code.match(/['"]/g) || []).length,
            confidence: 0.85,
        });
        profile.quotes = quotes;

        // Detect semicolons
        const semicolons = detectSemicolons(code);
        patterns.push({
            name: 'semicolons',
            detected: semicolons ? 'yes' : 'no',
            count: (code.match(/;/g) || []).length,
            confidence: 0.9,
        });
        profile.semicolons = semicolons;
    }

    // Detect early returns
    const earlyReturns = detectEarlyReturns(code);
    patterns.push({
        name: 'earlyReturns',
        detected: earlyReturns ? 'preferred' : 'nested',
        count: 1,
        confidence: 0.7,
    });
    profile.preferEarlyReturns = earlyReturns;

    // Calculate overall confidence
    const avgConfidence = patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length;

    return {
        profile,
        confidence: avgConfidence,
        patterns,
    };
}
