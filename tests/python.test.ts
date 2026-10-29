import { describe, expect, it } from 'vitest';
import { beautify, renamesOf } from './helpers.js';
import { tokenize } from '../src/languages/python-tokens.js';
import { formatPythonBuiltin, pythonExecutable } from '../src/languages/python.js';

const hasPython = !!pythonExecutable();

describe('Python tokenizer', () => {
    it('separates strings, comments and names', () => {
        const toks = tokenize(`x = "a # not comment" # real\ny = 'n'\n`);
        expect(toks.filter(t => t.type === 'name').map(t => t.value)).toEqual(['x', 'y']);
        expect(toks.filter(t => t.type === 'comment')).toHaveLength(1);
    });

    it('tokenizes f-string fields but not conversions or format specs', () => {
        const names = tokenize(`f"{n!r} {v:>{w}} {{literal}}"\n`).filter(t => t.type === 'name').map(t => t.value);
        expect(names).toEqual(['n', 'v', 'w']);
    });

    it('handles triple-quoted and prefixed strings', () => {
        const toks = tokenize(`s = rb'''a\n'b'\n'''\nt = 1\n`);
        expect(toks.filter(t => t.type === 'string')).toHaveLength(1);
        expect(toks.filter(t => t.type === 'name').map(t => t.value)).toEqual(['s', 't']);
    });
});

describe('Python renaming', () => {
    it('renames locals with evidence and leaves strings, attributes and kwargs alone', async () => {
        const code = [
            'def proc(u):',
            "    n = u['name']",
            '    t = 0',
            '    for x in u.items:',
            '        t += x.price',
            "    print('n', f'{n}', u.n)",
            '    return make(n=n, total=t)',
            '',
        ].join('\n');
        const r = await beautify(code, 'a.py');
        expect(renamesOf(r)).toEqual(['n->name', 't->total', 'x->item']);
        expect(r.beautified).toContain("name = u['name']");
        expect(r.beautified).toContain("print('n', f'{name}', u.n)");
        expect(r.beautified).toContain('make(n=name, total=total)');
    });

    it('never renames parameters (callers may use keywords)', async () => {
        const code = 'def f(n, v):\n    return n + v\n';
        expect((await beautify(code, 'a.py')).renames).toEqual([]);
    });

    it('skips functions that use locals() or eval', async () => {
        const code = "def f(u):\n    n = u.name\n    return locals()['n']\n";
        expect((await beautify(code, 'a.py')).renames).toEqual([]);
    });

    it('skips global and nonlocal names', async () => {
        const code = 'def f(u):\n    global n\n    n = u.name\n    return n\n';
        expect((await beautify(code, 'a.py')).renames).toEqual([]);
    });

    it('names exception and loop variables', async () => {
        const code = 'def f(users):\n    try:\n        return [u.id for u in users]\n    except ValueError as e:\n        raise RuntimeError(e)\n';
        const r = await beautify(code, 'a.py');
        expect(renamesOf(r).sort()).toEqual(['e->error', 'u->user']);
        expect(r.beautified).toContain('[user.id for user in users]');
    });
});

describe('Python built-in formatter', () => {
    it('only adjusts whitespace', () => {
        const code = [
            'def f(a,b=1,*args,**kw)->int:',
            '    x=a+b',
            '    x+=1',
            "    s='a=b,c'",
            '    y=-x if x>0 else x**2',
            '    return f(a=x,b=y)[1:-1]',
        ].join('\n');
        const out = formatPythonBuiltin(code);
        expect(out).toBe([
            'def f(a, b=1, *args, **kw) -> int:',
            '    x = a + b',
            '    x += 1',
            "    s = 'a=b,c'",
            '    y = -x if x > 0 else x**2',
            '    return f(a=x, b=y)[1:-1]',
            '',
        ].join('\n'));
    });

    it('adds blank lines between top-level definitions and keeps comments attached', () => {
        const out = formatPythonBuiltin('import os\ndef a():\n    pass\n# about b\ndef b():\n    pass\n');
        expect(out).toBe('import os\n\n\ndef a():\n    pass\n\n\n# about b\ndef b():\n    pass\n');
    });

    it('leaves multi-line strings untouched', () => {
        const code = 'x = """\n  a=b   \n\tc\n"""\n';
        expect(formatPythonBuiltin(code)).toBe(code);
    });

    it('converts tab indentation', () => {
        expect(formatPythonBuiltin('if x:\n\ty = 1\n')).toBe('if x:\n    y = 1\n');
    });
});

describe('Python docs', () => {
    it('inserts docstrings inside the function body, once', async () => {
        const code = 'def get_user_name(u):\n    return u.name\n';
        const first = await beautify(code, 'a.py', { explain: true });
        expect(first.beautified).toContain('def get_user_name(u):\n    """Gets the user name."""\n    return u.name');
        const second = await beautify(first.beautified, 'a.py', { explain: true });
        expect(second.changed).toBe(false);
    });
});

describe.skipIf(!hasPython)('Python validation', () => {
    it('refuses files that do not parse', async () => {
        const r = await beautify('def f(:\n    pass\n', 'a.py');
        expect(r.error).toMatch(/could not parse/);
    });

    it('keeps the example file valid after every transformation', async () => {
        const { readFileSync } = await import('node:fs');
        const code = readFileSync('examples/messy.py', 'utf8');
        const r = await beautify(code, 'examples/messy.py', { explain: true, explainLevel: 'pr-review' });
        expect(r.error).toBeUndefined();
        expect(r.warnings).toEqual([]);
        expect(r.renames.length).toBeGreaterThan(0);
    });
});
