import { describe, expect, it } from 'vitest';
import { beautify, renamesOf } from './helpers.js';
import { getPlugin } from '../src/languages/index.js';

describe('JavaScript renaming', () => {
    it('does not name destructured bindings after their source object', async () => {
        const code = `function f(d) {\n  const { n } = d.customer;\n  return n;\n}\n`;
        const r = await beautify(code, 'a.js');
        expect(renamesOf(r)).toEqual([]);
    });

    it('expands short forms of what a variable holds', async () => {
        const code = `async function f(id) {\n  const res = await fetch(id);\n  const d = await res.json();\n  const cnt = d.items.length;\n  return [d, cnt];\n}\n`;
        const r = await beautify(code, 'a.js');
        expect(renamesOf(r)).toEqual(['res->response', 'd->data', 'cnt->count']);
    });

    it('renames locals that have clear evidence', async () => {
        const code = `function proc(u) {\n  const n = u.name;\n  const a = u.age;\n  let s = 0;\n  for (const x of u.items) s += x;\n  return [n, a, s];\n}\nmodule.exports = { proc };\n`;
        const r = await beautify(code, 'a.js');
        expect(renamesOf(r)).toEqual(['n->name', 'a->age', 's->total', 'x->item']);
        expect(r.beautified).toContain('const name = u.name;');
        expect(r.beautified).toContain('for (const item of u.items) total += item;');
    });

    it('never touches exports, properties, or object keys', async () => {
        const code = `function f(n) {\n  const r = { n: n, x: this.n };\n  return r;\n}\nexport { f };\n`;
        const r = await beautify(code, 'a.js');
        expect(r.beautified).toContain('function f(');
        expect(r.beautified).toContain('n: n');
        expect(r.beautified).toContain('this.n');
        expect(r.beautified).toContain('export { f }');
    });

    it('expands shorthand properties instead of renaming the key', async () => {
        const code = `function g(u) {\n  const n = u.name;\n  return { n };\n}\n`;
        const r = await beautify(code, 'a.js');
        expect(r.beautified).toContain('return { n: name };');
    });

    it('expands shorthand in destructuring patterns', async () => {
        const plugin = getPlugin('javascript', 'a.js');
        const code = `function g(o) {\n  const { e } = o;\n  return e;\n}\n`;
        const cand = plugin.extractIdentifiers(code, { minNameLength: 3 }).find(c => c.name === 'e')!;
        const out = plugin.applyRenames(code, [{ id: cand.id, original: 'e', suggested: 'entry', reason: '', confidence: 1, source: 'heuristic' }]);
        expect(out.code).toContain('const { e: entry } = o;');
        expect(out.code).toContain('return entry;');
    });

    it('keeps TypeScript type annotations', async () => {
        const code = `export function load(o: { a: string }): string[] {\n  const r: string[] = [];\n  r.push(o.a);\n  return r;\n}\n`;
        const r = await beautify(code, 'a.ts');
        expect(r.beautified).toContain('const results: string[] = [];');
    });

    it('skips TypeScript parameter properties', async () => {
        const code = `class A {\n  constructor(private v: number) {}\n}\n`;
        const r = await beautify(code, 'a.ts');
        expect(r.renames).toEqual([]);
    });

    it('does not rename module-level bindings', async () => {
        const code = `const n = window.name;\nconsole.log(n);\n`;
        const r = await beautify(code, 'a.js');
        expect(r.renames).toEqual([]);
    });

    it('skips a rename that would collide with an existing name', async () => {
        const code = `function f(u) {\n  const name = 'x';\n  const n = u.name;\n  return name + n;\n}\n`;
        const r = await beautify(code, 'a.js');
        expect(r.renames).toEqual([]);
        expect(r.skippedRenames[0].why).toMatch(/already/);
    });

    it('skips a rename that would capture an outer reference', async () => {
        const code = `function f(u, name) {\n  const n = u.name;\n  return () => name + n;\n}\n`;
        const r = await beautify(code, 'a.js');
        expect(r.renames).toEqual([]);
    });

    it('does not rename anything in a scope that uses eval', async () => {
        const code = `function f(u) {\n  const n = u.name;\n  return eval('n');\n}\n`;
        const r = await beautify(code, 'a.js');
        expect(r.renames).toEqual([]);
    });

    it('names catch, event and callback parameters', async () => {
        const code = `function f(users) {\n  try { users.map(u => u.id); } catch (e) { console.error(e); }\n  document.addEventListener('click', (ev) => ev.preventDefault());\n}\n`;
        const r = await beautify(code, 'a.js');
        expect(renamesOf(r).sort()).toEqual(['e->error', 'ev->event', 'u->user']);
    });

    it('leaves loop indices and single letters without evidence alone', async () => {
        const code = `function f(a, b) {\n  for (let i = 0; i < a; i++) b += i;\n  return b;\n}\n`;
        const r = await beautify(code, 'a.js');
        expect(r.renames).toEqual([]);
    });

    it('respects profiles that disable renaming', async () => {
        const code = `function f(u) {\n  const n = u.name;\n  return n;\n}\n`;
        const r = await beautify(code, 'a.js', { style: 'competitive' });
        expect(r.renames).toEqual([]);
    });

    it('is idempotent', async () => {
        const code = `function proc(u){const n=u.name;let s=0;for(const x of u.items){s+=x}return {n,s}}\n`;
        const first = await beautify(code, 'a.js', { explain: true });
        const second = await beautify(first.beautified, 'a.js', { explain: true });
        expect(second.changed).toBe(false);
    });
});

describe('JavaScript formatting and safety', () => {
    it('applies the style profile', async () => {
        const code = `const a = {b: "c"}\n`;
        expect((await beautify(code, 'a.js', { style: 'airbnb' })).beautified).toBe(`const a = { b: 'c' };\n`);
        const minimal = (await beautify(code, 'a.js', { style: 'google' })).beautified;
        expect(minimal).toContain(';');
    });

    it('refuses files that do not parse', async () => {
        const r = await beautify(`function (\n`, 'a.js');
        expect(r.error).toMatch(/could not parse/);
        expect(r.beautified).toBe(`function (\n`);
    });

    it('handles JSX', async () => {
        const code = `export function App({ items }) {\n  return <ul>{items.map(i => <li key={i.id}>{i.name}</li>)}</ul>;\n}\n`;
        const r = await beautify(code, 'a.jsx');
        expect(r.error).toBeUndefined();
        expect(r.beautified).toContain('items.map((item) =>');
    });
});

describe('JavaScript docs and analysis', () => {
    it('adds doc comments only to undocumented functions', async () => {
        const code = `/** Existing. */\nfunction getUserName(u) { return u.name; }\nfunction calculateTotal(items) { return items.length; }\n`;
        const r = await beautify(code, 'a.js', { explain: true });
        expect(r.docs.map(d => d.target)).toEqual(['calculateTotal']);
        expect(r.beautified).toContain('/** Calculates the total. */');
        expect(r.beautified.match(/Existing/g)).toHaveLength(1);
    });

    it('suggests guard clauses for nested ifs', async () => {
        const code = `function f(u) {\n  if (u) {\n    if (u.ok) {\n      if (u.age >= 18) {\n        if (!u.banned) {\n          return 1;\n        }\n      }\n    }\n  }\n  return 0;\n}\n`;
        const r = await beautify(code, 'a.js', { refactor: true });
        const s = r.suggestions.find(x => x.type === 'simplify-conditional')!;
        expect(s.title).toMatch(/guard clauses/);
        expect(s.refactored).toContain('if (!u) return 0;');
        expect(s.refactored).toContain('if (u.age < 18) return 0;');
        expect(s.refactored).toContain('if (u.banned) return 0;');
    });

    it('finds magic numbers but ignores named and keyed values', async () => {
        const code = `function f(res, age) {\n  const LIMIT = 42;\n  const cfg = { timeout: 5000 };\n  if (res.status === 404) return null;\n  if (age >= 21) return cfg;\n  setTimeout(f, 3000);\n  return LIMIT;\n}\n`;
        const r = await beautify(code, 'a.js', { refactor: true });
        const names = r.suggestions.filter(s => s.type === 'magic-constant').map(s => s.refactored.split('\n')[0]);
        expect(names).toEqual(['const HTTP_NOT_FOUND = 404;', 'const AGE_THRESHOLD = 21;', 'const DELAY_MS = 3000;']);
    });

    it('reports dead and debug code', async () => {
        const code = `function f() {\n  console.log('x');\n  return 1;\n  f();\n  function hoisted() {}\n}\n`;
        const r = await beautify(code, 'a.js', { deadCode: true });
        expect(r.deadCode.map(d => d.reason)).toEqual(['Debug `console.log`', 'Unreachable code after `return`']);
    });
});
