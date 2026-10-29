import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OllamaProvider, parseJsonLoose } from '../src/ai/ollama.js';
import { beautify } from './helpers.js';

let server: Server;
let host = '';
let responder: (prompt: string, call: number) => unknown = () => ({});
let calls = 0;

beforeAll(async () => {
    server = createServer((req, res) => {
        let body = '';
        req.on('data', c => (body += c));
        req.on('end', () => {
            res.setHeader('content-type', 'application/json');
            if (req.url === '/api/tags') {
                res.end(JSON.stringify({ models: [{ name: 'llama3:8b' }, { name: 'qwen2.5-coder:7b' }] }));
                return;
            }
            if (req.url === '/api/generate') {
                const { prompt } = JSON.parse(body);
                const payload = responder(prompt, calls++);
                res.end(JSON.stringify({ model: 'qwen2.5-coder:7b', response: typeof payload === 'string' ? payload : JSON.stringify(payload), done: true }));
                return;
            }
            res.statusCode = 404;
            res.end('{}');
        });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const code = 'function f(u) {\n  const q = u.items.length;\n  const n = u.name;\n  return q + n;\n}\n';

describe('Ollama provider', () => {
    it('prefers an installed code model', async () => {
        const p = await OllamaProvider.connect({ host });
        expect(p.model).toBe('qwen2.5-coder:7b');
    });

    it('errors helpfully for a missing model', async () => {
        await expect(OllamaProvider.connect({ host, model: 'nope' })).rejects.toThrow(/ollama pull nope/);
    });

    it('applies names the model agrees on, and fills gaps with heuristics', async () => {
        calls = 0;
        responder = (prompt) => {
            const id = prompt.match(/id: (q@\S+)/)![1];
            return { renames: [{ id, name: 'item_count', confidence: 0.95, reason: 'number of items' }] };
        };
        const provider = await OllamaProvider.connect({ host, checks: 3 });
        const r = await beautify(code, 'a.js', { provider });
        expect(calls).toBe(3);
        expect(r.renames.map(x => [x.from, x.to, x.source])).toEqual([
            ['q', 'itemCount', 'ai'],
            ['n', 'name', 'heuristic'],
        ]);
    });

    it('ignores names without a majority', async () => {
        calls = 0;
        responder = (prompt, call) => {
            const id = prompt.match(/id: (q@\S+)/)![1];
            return { renames: [{ id, name: ['alpha', 'beta', 'gamma'][call % 3], confidence: 0.9 }] };
        };
        const provider = await OllamaProvider.connect({ host, checks: 3 });
        const r = await beautify(code, 'a.js', { provider });
        // No AI name wins, so the evidence-based heuristic fills in (`u.items.length` → `length`).
        expect(r.renames.map(x => [x.from, x.to, x.source])).toEqual([
            ['q', 'length', 'heuristic'],
            ['n', 'name', 'heuristic'],
        ]);
    });

    it('rejects invalid or reserved names from the model', async () => {
        responder = (prompt) => {
            const id = prompt.match(/id: (q@\S+)/)![1];
            return { renames: [{ id, name: 'class', confidence: 1 }] };
        };
        const provider = await OllamaProvider.connect({ host, checks: 1 });
        const r = await beautify(code, 'a.js', { provider });
        expect(r.renames.map(x => x.to)).not.toContain('class');
        expect(r.renames.every(x => x.source === 'heuristic')).toBe(true);
    });

    it('survives garbage responses', async () => {
        responder = () => 'not json at all';
        const provider = await OllamaProvider.connect({ host, checks: 1 });
        const r = await beautify(code, 'a.js', { provider });
        expect(r.error).toBeUndefined();
        expect(r.warnings.join()).toMatch(/invalid JSON/);
    });

    it('writes doc summaries from the model', async () => {
        responder = (prompt) => {
            const id = prompt.match(/### id: (\S+)/)![1];
            return { docs: [{ id, summary: 'Adds the item count to the user name', notes: [] }] };
        };
        const provider = await OllamaProvider.connect({ host, checks: 1 });
        const r = await beautify('function f(u) {\n  return u;\n}\n', 'a.js', { provider, explain: true, rename: false });
        expect(r.beautified).toContain('/** Adds the item count to the user name. */');
        expect(r.docs[0].source).toBe('ai');
    });

    it('parses JSON wrapped in prose', () => {
        expect(parseJsonLoose('Sure! {"a": 1} hope that helps')).toEqual({ a: 1 });
    });
});
