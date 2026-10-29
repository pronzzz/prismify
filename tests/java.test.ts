import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { beautify } from './helpers.js';
import { maskJava } from '../src/languages/java.js';

describe('Java', () => {
    it('formats with a real Java parser and never renames', async () => {
        const code = readFileSync('examples/messy.java', 'utf8');
        const r = await beautify(code, 'examples/messy.java');
        expect(r.error).toBeUndefined();
        expect(r.renames).toEqual([]);
        expect(r.beautified).toContain('public static int calc(int a, int b, int c) {');
        expect(r.beautified).toContain('    private String n;');
    });

    it('refuses files that do not parse', async () => {
        const r = await beautify('class A { void f( }', 'A.java');
        expect(r.error).toMatch(/could not parse/);
    });

    it('masks strings and comments for analysis', () => {
        expect(maskJava('int a = 1; // 404\nString s = "500";')).toBe('int a = 1;       \nString s = "   ";');
    });

    it('finds magic numbers outside strings and constants', async () => {
        const code = 'class A {\n    static final int OK = 200;\n    int f(int code) {\n        String s = "404";\n        if (code == 404) { return 1; }\n        return code * 3;\n    }\n}\n';
        const r = await beautify(code, 'A.java', { refactor: true });
        expect(r.suggestions.map(s => s.title)).toEqual(['Name the magic number 404']);
        expect(r.suggestions[0].refactored).toContain('private static final int HTTP_NOT_FOUND = 404;');
    });

    it('suggests guard clauses for nested ifs in methods', async () => {
        const code = 'class A {\n    int f(User u) {\n        if (u != null) {\n            if (u.ok()) {\n                if (u.age() >= 18) {\n                    if (!u.banned()) {\n                        return 1;\n                    }\n                }\n            }\n        }\n        return 0;\n    }\n}\n';
        const r = await beautify(code, 'A.java', { refactor: true });
        const s = r.suggestions.find(x => x.type === 'simplify-conditional')!;
        expect(s.refactored.split('\n').slice(0, 4)).toEqual([
            'if (u == null) return 0;',
            'if (!u.ok()) return 0;',
            'if (u.age() < 18) return 0;',
            'if (u.banned()) return 0;',
        ]);
    });

    it('documents undocumented methods with Javadoc', async () => {
        const code = 'class A {\n    /** Already documented. */\n    int getCount() { return 1; }\n\n    void resetState() {}\n}\n';
        const r = await beautify(code, 'A.java', { explain: true });
        expect(r.docs.map(d => d.target)).toEqual(['resetState']);
        expect(r.beautified).toContain('/** Resets the state. */');
    });
});
