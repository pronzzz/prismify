/**
 * Heuristic provider: works offline with no model.
 *
 * It only proposes a rename when the code itself gives evidence for the new
 * name (the property a value was read from, a catch clause, the collection a
 * callback iterates, an accumulator pattern, a well-known abbreviation).
 * It never guesses from a single letter alone.
 */

import type {
    AIProvider,
    ExplainLevel,
    FunctionInfo,
    Identifier,
    NamingSuggestion,
    ProviderContext,
} from '../types/index.js';
import { conventionalName, elementNameFor, isValidIdentifier, splitWords } from '../core/naming.js';

/** Abbreviations that are expanded even when they are longer than the minimum name length. */
export const ABBREVIATIONS: Record<string, string> = {
    cfg: 'config',
    conf: 'config',
    msg: 'message',
    msgs: 'messages',
    btn: 'button',
    usr: 'user',
    pwd: 'password',
    elem: 'element',
    evt: 'event',
    cnt: 'count',
    qty: 'quantity',
    amt: 'amount',
    img: 'image',
    ctr: 'counter',
    val: 'value',
    vals: 'values',
    idx: 'index',
    // Two-letter forms (also caught by the length rule).
    el: 'element',
    ev: 'event',
    cb: 'callback',
    tx: 'transaction',
};

const ROLE_NAMES: Record<string, { name: string; confidence: number; why: string }> = {
    error: { name: 'error', confidence: 0.9, why: 'caught exception' },
    event: { name: 'event', confidence: 0.85, why: 'event handler argument' },
    accumulator: { name: 'total', confidence: 0.8, why: 'starts at 0 and is added to' },
    counter: { name: 'count', confidence: 0.8, why: 'starts at 0 and is incremented' },
    text: { name: 'text', confidence: 0.7, why: "starts as '' and is appended to" },
    items: { name: 'results', confidence: 0.75, why: 'starts empty and is pushed to' },
    result: { name: 'result', confidence: 0.75, why: 'only used as the return value' },
};

export class HeuristicProvider implements AIProvider {
    name = 'heuristic';
    label = 'heuristic (offline)';

    async suggestNames(candidates: Identifier[], ctx: ProviderContext): Promise<NamingSuggestion[]> {
        const out: NamingSuggestion[] = [];
        for (const c of candidates) {
            const s = heuristicName(c, ctx.language);
            if (s) out.push(s);
        }
        return out;
    }

    async summarizeFunctions(fns: FunctionInfo[], level: ExplainLevel): Promise<Map<string, string>> {
        const out = new Map<string, string>();
        for (const fn of fns) {
            const summary = summarizeFromName(fn, level);
            if (summary) out.set(fn.id, summary);
        }
        return out;
    }
}

/** Best evidence-backed name for one candidate, or null. */
export function heuristicName(c: Identifier, language: ProviderContext['language']): NamingSuggestion | null {
    const h = c.hints ?? {};
    const options: Array<{ name: string; confidence: number; why: string }> = [];

    if (h.role === 'error' || h.role === 'event') options.push(ROLE_NAMES[h.role]);
    // A known abbreviation (cnt, msg, cfg) says more than where the value came from.
    const abbr = ABBREVIATIONS[c.name];
    if (abbr && c.name.length >= 3) options.push({ name: abbr, confidence: 0.85, why: `expands the abbreviation \`${c.name}\`` });
    if (h.initFrom) options.push({ name: h.initFrom, confidence: 0.9, why: `assigned from \`${h.initFrom}\`` });
    if (h.iterates) {
        const el = elementNameFor(h.iterates);
        options.push({ name: el, confidence: el === 'item' ? 0.75 : 0.85, why: `element of \`${h.iterates}\`` });
    }
    if (h.role && !['error', 'event'].includes(h.role)) options.push(ROLE_NAMES[h.role]);
    if (abbr && c.name.length < 3) options.push({ name: abbr, confidence: 0.8, why: `expands the abbreviation \`${c.name}\`` });

    for (const opt of options) {
        const name = conventionalName(opt.name, c.type, language);
        if (name === c.name || !isValidIdentifier(name, language)) continue;
        return {
            id: c.id,
            original: c.name,
            suggested: name,
            reason: opt.why,
            confidence: opt.confidence,
            source: 'heuristic',
        };
    }
    return null;
}

const VERBS: Record<string, string> = {
    get: 'Gets', set: 'Sets', calc: 'Calculates', calculate: 'Calculates', compute: 'Computes',
    proc: 'Processes', process: 'Processes', handle: 'Handles', parse: 'Parses', format: 'Formats',
    load: 'Loads', fetch: 'Fetches', save: 'Saves', store: 'Stores', create: 'Creates', make: 'Makes',
    build: 'Builds', update: 'Updates', delete: 'Deletes', remove: 'Removes', find: 'Finds',
    search: 'Searches for', validate: 'Validates', check: 'Checks', render: 'Renders',
    init: 'Initializes', initialize: 'Initializes', setup: 'Sets up', convert: 'Converts',
    add: 'Adds', sum: 'Sums', sort: 'Sorts', filter: 'Filters', map: 'Maps', send: 'Sends',
    read: 'Reads', write: 'Writes', open: 'Opens', close: 'Closes', start: 'Starts', stop: 'Stops',
    run: 'Runs', exec: 'Executes', execute: 'Executes', apply: 'Applies', merge: 'Merges',
    normalize: 'Normalizes', generate: 'Generates', gen: 'Generates', print: 'Prints', log: 'Logs',
    reset: 'Resets', clear: 'Clears', register: 'Registers', resolve: 'Resolves', transform: 'Transforms',
    serialize: 'Serializes', encode: 'Encodes', decode: 'Decodes', count: 'Counts', ensure: 'Ensures',
    to: 'Converts to', show: 'Shows', hide: 'Hides', toggle: 'Toggles', select: 'Selects',
};

const PREDICATES = new Set(['is', 'has', 'can', 'should', 'needs', 'contains', 'includes']);

function humanList(items: string[]): string {
    if (items.length <= 1) return items.join('');
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Build a summary from the function's name. Returns null for cryptic names. */
export function summarizeFromName(fn: FunctionInfo, level: ExplainLevel): string | null {
    const words = splitWords(fn.name.replace(/^#/, ''));
    if (words.length === 0) return null;
    const meaningful = words.filter(w => w.length >= 3 || VERBS[w] || PREDICATES.has(w));
    if (meaningful.length === 0) return null;

    const [first, ...rest] = words;
    const params = fn.params.filter(p => !p.startsWith('...')).map(p => `\`${p}\``);
    let sentence: string;
    if (fn.name === 'constructor') {
        sentence = params.length ? `Creates a new instance from ${humanList(params)}.` : 'Creates a new instance.';
    } else if (PREDICATES.has(first)) {
        if (rest.length === 0) sentence = 'Checks a condition.';
        else if (first === 'is') sentence = `Checks whether the value is ${rest.join(' ')}.`;
        else sentence = `Checks whether it ${first} ${rest.join(' ')}.`;
    } else if (first === 'on' && rest.length) {
        sentence = `Handles the ${rest.join(' ')} event.`;
    } else if (VERBS[first]) {
        const object = rest.length ? `the ${rest.join(' ')}` : params.length ? humanList(params) : 'the input';
        sentence = `${VERBS[first]} ${object}.`;
        if (rest.length === 0 && params.length && ['calc', 'calculate', 'compute'].includes(first)) {
            sentence = `${VERBS[first]} a value from ${humanList(params)}.`;
        }
    } else {
        sentence = `Handles ${words.join(' ')}.`;
    }

    const notes = traitNotes(fn, level);
    if (level === 'beginner') {
        const extra: string[] = [];
        if (params.length) extra.push(`It takes ${humanList(params)} as input`);
        if (fn.returnsValue) extra.push(extra.length ? 'and returns a result' : 'It returns a result');
        const second = extra.length ? `${extra.join(' ')}.` : '';
        return [sentence, second, ...notes].filter(Boolean).join('\n');
    }
    if (level === 'pr-review') return [sentence, ...notes].join('\n');
    return sentence;
}

/** Plain-language notes about side effects and behaviour. */
export function traitNotes(fn: FunctionInfo, level: ExplainLevel): string[] {
    const notes: string[] = [];
    const t = new Set(fn.traits);
    if (t.has('async')) notes.push(level === 'beginner' ? 'It is asynchronous, so callers should `await` it.' : 'Async: returns a Promise.');
    if (t.has('network')) notes.push('Side effect: makes a network request.');
    if (t.has('filesystem')) notes.push('Side effect: touches the filesystem.');
    if (t.has('logs')) notes.push('Side effect: writes to the console.');
    if (t.has('mutates-this')) notes.push('Side effect: updates instance state.');
    if (t.has('timers')) notes.push('Schedules a timer.');
    if (t.has('throws')) notes.push(level === 'beginner' ? 'It can throw an error, so callers may need to handle that.' : 'May throw.');
    return notes;
}
