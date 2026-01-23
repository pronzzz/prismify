/**
 * Prismify Core Types
 * Shared type definitions for the code beautification engine
 */

// Re-export refactor types
export * from './refactor.js';

// Re-export explain types  
export * from './explain.js';

/**
 * Supported programming languages
 */
export type SupportedLanguage = 'javascript' | 'typescript' | 'python' | 'java';

/**
 * Beautification options
 */
export interface BeautifyOptions {
    /** Target language (auto-detected if not specified) */
    language?: SupportedLanguage;

    /** Enable AI-powered variable/function renaming */
    aiRenaming?: boolean;

    /** Remove dead/unreachable code */
    removeDeadCode?: boolean;

    /** Show diff preview instead of writing changes */
    preview?: boolean;

    /** Verbosity level for explanations */
    explainLevel?: 'none' | 'minimal' | 'detailed';
}

/**
 * A single code change with explanation
 */
export interface CodeChange {
    /** Type of change made */
    type: 'rename' | 'format' | 'remove-dead-code' | 'normalize';

    /** Original code fragment */
    original: string;

    /** New code fragment */
    replacement: string;

    /** Line number where change occurs (1-indexed) */
    line: number;

    /** Human-readable explanation of why this change was made */
    explanation: string;

    /** Confidence score 0-1 (higher = more confident) */
    confidence: number;
}

/**
 * Result of beautification process
 */
export interface BeautifyResult {
    /** Original source code */
    original: string;

    /** Beautified source code */
    beautified: string;

    /** List of all changes made */
    changes: CodeChange[];

    /** Detected or specified language */
    language: SupportedLanguage;

    /** Whether the output is syntactically valid */
    isValid: boolean;

    /** Error message if validation failed */
    validationError?: string;

    /** Processing time in milliseconds */
    processingTime: number;
}

/**
 * Variable/function identifier with context
 */
export interface Identifier {
    /** Current name */
    name: string;

    /** Type of identifier */
    type: 'variable' | 'function' | 'class' | 'parameter';

    /** Surrounding code context for AI analysis */
    context: string;

    /** Line number (1-indexed) */
    line: number;

    /** Column number (0-indexed) */
    column: number;
}

/**
 * AI naming suggestion with constraints
 */
export interface NamingSuggestion {
    /** Original identifier name */
    original: string;

    /** Suggested new name */
    suggested: string;

    /** Explanation for the suggestion */
    reason: string;

    /** Confidence score 0-1 */
    confidence: number;

    /** Whether this should be applied (confidence > threshold) */
    shouldApply: boolean;
}

/**
 * Language plugin interface
 */
export interface LanguagePlugin {
    /** Language identifier */
    language: SupportedLanguage;

    /** File extensions this plugin handles */
    extensions: string[];

    /** Parse code and extract identifiers */
    extractIdentifiers(code: string): Identifier[];

    /** Apply formatting rules */
    format(code: string): Promise<string>;

    /** Rename an identifier throughout the code */
    renameIdentifier(code: string, oldName: string, newName: string, line: number): string;

    /** Validate syntax */
    validate(code: string): { valid: boolean; error?: string };

    /** Detect dead code locations */
    findDeadCode?(code: string): Array<{ start: number; end: number; reason: string }>;
}

/**
 * AI provider interface for naming suggestions
 */
export interface AIProvider {
    /** Provider name */
    name: string;

    /** Check if provider is available */
    isAvailable(): Promise<boolean>;

    /** Suggest better name for an identifier */
    suggestName(identifier: Identifier): Promise<NamingSuggestion>;

    /** Explain a code change */
    explainChange(before: string, after: string): Promise<string>;
}

/**
 * Configuration for Ollama anti-hallucination constraints
 */
export interface OllamaConfig {
    /** Model to use (recommend: codellama, deepseek-coder) */
    model: string;

    /** Temperature (lower = more deterministic, less hallucination) */
    temperature: number;

    /** Top-p sampling (lower = more focused) */
    topP: number;

    /** Top-k sampling */
    topK: number;

    /** Maximum tokens in response */
    maxTokens: number;

    /** Number of times to re-query for consistency check */
    consistencyChecks: number;

    /** Minimum agreement ratio for consistency */
    consistencyThreshold: number;

    /** Minimum confidence to apply a suggestion */
    confidenceThreshold: number;
}

/**
 * Default Ollama configuration optimized for minimal hallucination
 */
export const DEFAULT_OLLAMA_CONFIG: OllamaConfig = {
    model: 'codellama',
    temperature: 0.1,      // Very low temperature for deterministic output
    topP: 0.9,             // Slightly constrained sampling
    topK: 40,              // Limit vocabulary selection
    maxTokens: 50,         // Short responses only (just the name)
    consistencyChecks: 3,  // Query 3 times and check agreement
    consistencyThreshold: 0.67, // 2/3 must agree
    confidenceThreshold: 0.7,   // Only apply high-confidence suggestions
};
