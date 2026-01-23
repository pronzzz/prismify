/**
 * Style Profile Types
 * 
 * Defines configurable style preferences for code beautification.
 */

/**
 * Naming convention styles
 */
export type NamingConvention = 'camelCase' | 'snake_case' | 'PascalCase' | 'SCREAMING_SNAKE';

/**
 * Style preferences for a code profile
 */
export interface StyleProfile {
    /** Profile name */
    name: string;

    /** Profile description */
    description: string;

    /** Variable naming convention */
    variableNaming: NamingConvention;

    /** Function naming convention */
    functionNaming: NamingConvention;

    /** Class naming convention */
    classNaming: NamingConvention;

    /** Constant naming convention */
    constantNaming: NamingConvention;

    /** Prefer early returns over nested conditionals */
    preferEarlyReturns: boolean;

    /** Prefer ternary operators for simple conditionals */
    preferTernary: boolean;

    /** Maximum nesting depth before suggesting refactor */
    maxNestingDepth: number;

    /** Prefer const over let where possible */
    preferConst: boolean;

    /** Prefer arrow functions */
    preferArrowFunctions: boolean;

    /** Maximum line length */
    maxLineLength: number;

    /** Indent style */
    indentStyle: 'spaces' | 'tabs';

    /** Indent size (spaces) */
    indentSize: 2 | 4;

    /** Use semicolons (JS/TS) */
    semicolons: boolean;

    /** Quote style */
    quotes: 'single' | 'double';

    /** Trailing commas */
    trailingCommas: 'none' | 'es5' | 'all';

    /** Min variable name length */
    minNameLength: number;

    /** Max variable name length */
    maxNameLength: number;
}

/**
 * Built-in style profiles
 */
export const STYLE_PROFILES: Record<string, StyleProfile> = {
    google: {
        name: 'google',
        description: 'Google JavaScript Style Guide',
        variableNaming: 'camelCase',
        functionNaming: 'camelCase',
        classNaming: 'PascalCase',
        constantNaming: 'SCREAMING_SNAKE',
        preferEarlyReturns: true,
        preferTernary: false,
        maxNestingDepth: 4,
        preferConst: true,
        preferArrowFunctions: true,
        maxLineLength: 80,
        indentStyle: 'spaces',
        indentSize: 2,
        semicolons: true,
        quotes: 'single',
        trailingCommas: 'es5',
        minNameLength: 2,
        maxNameLength: 30,
    },

    airbnb: {
        name: 'airbnb',
        description: 'Airbnb JavaScript Style Guide',
        variableNaming: 'camelCase',
        functionNaming: 'camelCase',
        classNaming: 'PascalCase',
        constantNaming: 'SCREAMING_SNAKE',
        preferEarlyReturns: true,
        preferTernary: true,
        maxNestingDepth: 3,
        preferConst: true,
        preferArrowFunctions: true,
        maxLineLength: 100,
        indentStyle: 'spaces',
        indentSize: 2,
        semicolons: true,
        quotes: 'single',
        trailingCommas: 'all',
        minNameLength: 3,
        maxNameLength: 25,
    },

    minimal: {
        name: 'minimal',
        description: 'Minimal intervention - only fix obvious issues',
        variableNaming: 'camelCase',
        functionNaming: 'camelCase',
        classNaming: 'PascalCase',
        constantNaming: 'SCREAMING_SNAKE',
        preferEarlyReturns: false,
        preferTernary: false,
        maxNestingDepth: 5,
        preferConst: false,
        preferArrowFunctions: false,
        maxLineLength: 120,
        indentStyle: 'spaces',
        indentSize: 2,
        semicolons: true,
        quotes: 'single',
        trailingCommas: 'none',
        minNameLength: 1,
        maxNameLength: 40,
    },

    python: {
        name: 'python',
        description: 'PEP 8 Python Style Guide',
        variableNaming: 'snake_case',
        functionNaming: 'snake_case',
        classNaming: 'PascalCase',
        constantNaming: 'SCREAMING_SNAKE',
        preferEarlyReturns: true,
        preferTernary: false,
        maxNestingDepth: 3,
        preferConst: true,
        preferArrowFunctions: false,
        maxLineLength: 79,
        indentStyle: 'spaces',
        indentSize: 4,
        semicolons: false,
        quotes: 'single',
        trailingCommas: 'all',
        minNameLength: 2,
        maxNameLength: 30,
    },

    competitive: {
        name: 'competitive',
        description: 'Competitive programming - short names OK',
        variableNaming: 'camelCase',
        functionNaming: 'camelCase',
        classNaming: 'PascalCase',
        constantNaming: 'SCREAMING_SNAKE',
        preferEarlyReturns: true,
        preferTernary: true,
        maxNestingDepth: 6,
        preferConst: false,
        preferArrowFunctions: true,
        maxLineLength: 100,
        indentStyle: 'spaces',
        indentSize: 2,
        semicolons: true,
        quotes: 'single',
        trailingCommas: 'none',
        minNameLength: 1, // Single letter vars OK
        maxNameLength: 15,
    },
};

/**
 * Default profile
 */
export const DEFAULT_PROFILE = STYLE_PROFILES.airbnb;

/**
 * Get a style profile by name
 */
export function getProfile(name: string): StyleProfile | undefined {
    return STYLE_PROFILES[name.toLowerCase()];
}

/**
 * List available profile names
 */
export function listProfiles(): string[] {
    return Object.keys(STYLE_PROFILES);
}
