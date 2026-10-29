/**
 * JavaScript / TypeScript plugin.
 *
 * Parsing and scope analysis come from Babel, formatting from Prettier.
 * Renames are scope-aware: only local bindings (function parameters and
 * variables inside functions or blocks) are touched, never module-level or
 * exported names, object keys, or `this.x` properties.
 */

import { parse, type ParserPlugin } from '@babel/parser';
import * as traverseNs from '@babel/traverse';
import type { NodePath, Binding, Scope } from '@babel/traverse';
import type * as t from '@babel/types';
import * as prettier from 'prettier';
import type {
    AppliedRename,
    DeadCode,
    FunctionInfo,
    Identifier,
    IdentifierHints,
    IdentifierKind,
    LanguagePlugin,
    MagicNumber,
    NamingSuggestion,
    NestedConditional,
    SkippedRename,
    SupportedLanguage,
    FormatContext,
} from '../types/index.js';
import { isValidIdentifier, toCamelCase } from '../core/naming.js';
import { ABBREVIATIONS } from '../ai/heuristic.js';

// Babel ships CommonJS; depending on the loader the function sits one or two `.default`s deep.
type TraverseFn = typeof traverseNs.default.default;
const traverse: TraverseFn = ((traverseNs as any).default?.default ?? (traverseNs as any).default ?? traverseNs) as TraverseFn;

const LOOP_INDEX_NAMES = new Set(['i', 'j', 'k', 'n', 'm']);
const ITERATOR_METHODS = new Set(['map', 'filter', 'forEach', 'find', 'findIndex', 'findLast', 'some', 'every', 'flatMap', 'sort']);
const GETTER_VERB = /^(get|fetch|load|read|find|create|make|build|compute|calc|calculate|parse|select|query|lookup|retrieve)(?=[A-Z_])/;

interface Candidate {
    id: string;
    binding: Binding;
    kind: IdentifierKind;
}

export class JavaScriptPlugin implements LanguagePlugin {
    language: SupportedLanguage;
    extensions: string[];
    canRename = true;
    private parserPlugins: ParserPlugin[];
    private sampleFile: string;

    constructor(opts: { typescript: boolean; jsx: boolean }) {
        this.language = opts.typescript ? 'typescript' : 'javascript';
        this.extensions = opts.typescript ? ['.ts', '.tsx', '.mts', '.cts'] : ['.js', '.jsx', '.mjs', '.cjs'];
        this.parserPlugins = ['decorators-legacy', 'classProperties', 'classPrivateProperties', 'topLevelAwait'];
        if (opts.typescript) this.parserPlugins.push('typescript');
        if (opts.jsx) this.parserPlugins.push('jsx');
        this.sampleFile = opts.typescript ? (opts.jsx ? 'file.tsx' : 'file.ts') : 'file.jsx';
    }

    private parse(code: string, errorRecovery = false): t.File {
        return parse(code, {
            sourceType: 'unambiguous',
            allowReturnOutsideFunction: true,
            allowAwaitOutsideFunction: true,
            errorRecovery,
            plugins: this.parserPlugins,
        }) as unknown as t.File;
    }

    // ── Rename candidates ────────────────────────────────────────────────

    /** Walk every local binding that is eligible for renaming. */
    private collectCandidates(ast: t.File, minNameLength: number, onlyIds?: Set<string>): Candidate[] {
        const candidates: Candidate[] = [];
        const seenScopes = new Set<number>();
        const unsafeScopes = new WeakSet<Scope>();

        traverse(ast, {
            // `eval` and `with` make scope analysis unreliable; never rename around them.
            CallExpression(path) {
                const callee = path.node.callee;
                if (callee.type === 'Identifier' && callee.name === 'eval' && !path.scope.getBinding('eval')) {
                    markUnsafe(path.scope);
                }
            },
            WithStatement(path) {
                markUnsafe(path.scope);
            },
        });

        function markUnsafe(scope: Scope) {
            let s: Scope | null = scope;
            while (s) {
                unsafeScopes.add(s);
                s = s.parent;
            }
        }

        traverse(ast, {
            Scopable: (path) => {
                const scope = path.scope;
                if (seenScopes.has(scope.uid)) return;
                seenScopes.add(scope.uid);
                if (scope.path.isProgram()) return;
                if (isInsideUnsafe(scope)) return;

                for (const [name, binding] of Object.entries(scope.bindings)) {
                    if (binding.scope !== scope) continue;
                    if (!this.isCandidateName(name, minNameLength) && !isShortFormOfInit(name, binding, minNameLength)) continue;
                    if (binding.kind === 'module') continue;
                    if (isLoopIndex(binding)) continue;
                    if (isParameterProperty(binding)) continue;
                    const loc = binding.identifier.loc;
                    if (!loc) continue;
                    const id = `${name}@${loc.start.line}:${loc.start.column}`;
                    if (onlyIds && !onlyIds.has(id)) continue;
                    candidates.push({ id, binding, kind: bindingKind(binding) });
                }
            },
        });

        function isInsideUnsafe(scope: Scope): boolean {
            return unsafeScopes.has(scope);
        }

        return candidates;
    }

    private isCandidateName(name: string, minNameLength: number): boolean {
        if (name.startsWith('_') || name.startsWith('$')) return false;
        if (minNameLength <= 1) return false; // profile opts out of renaming
        if (name.length < minNameLength) return true;
        return Object.prototype.hasOwnProperty.call(ABBREVIATIONS, name);
    }

    extractIdentifiers(code: string, opts: { minNameLength: number }): Identifier[] {
        let ast: t.File;
        try {
            ast = this.parse(code);
        } catch {
            return [];
        }
        return this.collectCandidates(ast, opts.minNameLength).map(({ id, binding, kind }) => {
            const loc = binding.identifier.loc!;
            return {
                id,
                name: binding.identifier.name,
                type: kind,
                line: loc.start.line,
                column: loc.start.column,
                context: contextFor(code, binding),
                hints: hintsFor(binding),
            };
        });
    }

    applyRenames(code: string, renames: NamingSuggestion[]) {
        const applied: AppliedRename[] = [];
        const skipped: SkippedRename[] = [];
        if (renames.length === 0) return { code, applied, skipped };

        const ast = this.parse(code);
        const byId = new Map(renames.map(r => [r.id, r]));
        // Every local binding qualifies here; we only keep the ids we were asked to rename.
        const candidates = this.collectCandidates(ast, Infinity, new Set(byId.keys()));

        const edits: Array<{ start: number; end: number; text: string }> = [];

        for (const suggestion of renames) {
            const cand = candidates.find(c => c.id === suggestion.id);
            const line = Number(suggestion.id.split('@')[1]?.split(':')[0] ?? 0);
            const skip = (why: string) =>
                skipped.push({ id: suggestion.id, from: suggestion.original, to: suggestion.suggested, line, why });

            if (!cand) {
                skip('binding not found');
                continue;
            }
            const { binding } = cand;
            const oldName = binding.identifier.name;
            const newName = suggestion.suggested;
            if (!isValidIdentifier(newName, this.language)) {
                skip(`"${newName}" is not a safe identifier`);
                continue;
            }
            const conflict = findConflict(binding, newName);
            if (conflict) {
                skip(conflict);
                continue;
            }

            const sites = renameSites(binding);
            for (const site of sites) {
                edits.push({ start: site.start, end: site.end, text: site.shorthand ? `${oldName}: ${newName}` : newName });
            }
            // Keep Babel's scope tables current so later conflict checks see this rename.
            binding.scope.rename(oldName, newName);
            applied.push({
                id: suggestion.id,
                from: oldName,
                to: newName,
                line,
                reason: suggestion.reason,
                confidence: suggestion.confidence,
                source: suggestion.source,
            });
        }

        const output = applyEdits(code, edits);
        // Prove the edit only changed names: the syntax trees must match except for the renamed identifiers.
        if (applied.length > 0) {
            const pairs = new Set(applied.map(a => `${a.from}\u0000${a.to}`));
            let same = false;
            try {
                same = sameShape(this.parse(code).program, this.parse(output).program, pairs);
            } catch {
                same = false;
            }
            if (!same) {
                return {
                    code,
                    applied: [],
                    skipped: skipped.concat(applied.map(a => ({ id: a.id, from: a.from, to: a.to, line: a.line, why: 'safety check failed; rename reverted' }))),
                };
            }
        }
        return { code: output, applied, skipped };
    }

    // ── Formatting & validation ──────────────────────────────────────────

    async format(code: string, ctx: FormatContext): Promise<string> {
        const p = ctx.profile;
        let options: prettier.Options = {
            semi: p.semicolons,
            singleQuote: p.quotes === 'single',
            tabWidth: p.indentSize,
            useTabs: p.indentStyle === 'tabs',
            trailingComma: p.trailingCommas,
            printWidth: p.maxLineLength,
        };
        if (ctx.projectConfig && ctx.filePath) {
            const project = await prettier.resolveConfig(ctx.filePath).catch(() => null);
            if (project) options = { ...options, ...project };
        }
        return prettier.format(code, { ...options, filepath: ctx.filePath || this.sampleFile });
    }

    async validate(code: string) {
        try {
            this.parse(code);
            return { valid: true, checked: true };
        } catch (error: any) {
            return { valid: false, checked: true, error: error.message as string };
        }
    }

    // ── Documentation ────────────────────────────────────────────────────

    extractFunctions(code: string): FunctionInfo[] {
        let ast: t.File;
        try {
            ast = this.parse(code);
        } catch {
            return [];
        }
        const found: FunctionInfo[] = [];
        const seenLines = new Set<number>();

        const add = (fnPath: NodePath<t.Function>, name: string, anchor: t.Node) => {
            const line = anchor.loc?.start.line;
            if (!line || seenLines.has(line)) return;
            seenLines.add(line);
            const fn = fnPath.node;
            found.push({
                id: `${name}@${line}`,
                name,
                line,
                params: fn.params.map(paramName),
                // A comment only documents the function if it ends on the line right above it.
                hasDoc: (anchor.leadingComments ?? []).some(c => (c.loc?.end.line ?? -10) >= (anchor.loc?.start.line ?? 0) - 1),
                isAsync: !!fn.async,
                returnsValue: returnsValue(fnPath),
                body: code.slice(fn.start ?? 0, Math.min(fn.end ?? 0, (fn.start ?? 0) + 1500)),
                traits: functionTraits(fnPath),
            });
        };

        traverse(ast, {
            FunctionDeclaration(path) {
                if (!path.node.id) return;
                const parent = path.parentPath;
                const anchor = parent.isExportNamedDeclaration() || parent.isExportDefaultDeclaration() ? parent.node : path.node;
                add(path, path.node.id.name, anchor);
            },
            'ArrowFunctionExpression|FunctionExpression'(p) {
                const path = p as NodePath<t.ArrowFunctionExpression | t.FunctionExpression>;
                const parent = path.parentPath;
                if (parent.isVariableDeclarator() && parent.node.id.type === 'Identifier') {
                    const decl = parent.parentPath;
                    if (!decl?.isVariableDeclaration() || decl.node.declarations.length !== 1) return;
                    // Only top-level or statement-level declarations get docs.
                    const outer = decl.parentPath;
                    const anchor = outer?.isExportNamedDeclaration() ? outer.node : decl.node;
                    add(path, parent.node.id.name, anchor);
                } else if ((parent.isClassProperty() || parent.isObjectProperty()) && parent.node.key.type === 'Identifier') {
                    add(path, parent.node.key.name, parent.node);
                }
            },
            'ClassMethod|ObjectMethod|ClassPrivateMethod'(p) {
                const path = p as NodePath<t.ClassMethod | t.ObjectMethod | t.ClassPrivateMethod>;
                const key = path.node.key as t.Node;
                const name = key.type === 'Identifier' ? key.name : key.type === 'PrivateName' ? `#${key.id.name}` : null;
                if (name) add(path as NodePath<t.Function>, name, path.node);
            },
        });

        return found.sort((a, b) => a.line - b.line);
    }

    insertDocs(code: string, docs: Array<{ fn: FunctionInfo; text: string }>): string {
        return insertBlockComments(code, docs);
    }

    // ── Analysis ─────────────────────────────────────────────────────────

    findDeadCode(code: string): DeadCode[] {
        let ast: t.File;
        try {
            ast = this.parse(code);
        } catch {
            return [];
        }
        const found: DeadCode[] = [];
        traverse(ast, {
            'ReturnStatement|ThrowStatement|BreakStatement|ContinueStatement'(path) {
                const container = path.container;
                if (!Array.isArray(container)) return;
                const idx = container.indexOf(path.node as any);
                const rest = (container as t.Statement[]).slice(idx + 1).filter(s => s.type !== 'FunctionDeclaration');
                if (rest.length > 0 && rest[0].loc && rest[rest.length - 1].loc) {
                    found.push({
                        start: rest[0].loc.start.line,
                        end: rest[rest.length - 1].loc!.end.line,
                        reason: `Unreachable code after \`${path.node.type.replace('Statement', '').toLowerCase()}\``,
                    });
                }
            },
            DebuggerStatement(path) {
                const loc = path.node.loc;
                if (loc) found.push({ start: loc.start.line, end: loc.end.line, reason: '`debugger` statement' });
            },
            CallExpression(path) {
                const callee = path.node.callee;
                if (
                    callee.type === 'MemberExpression' &&
                    callee.object.type === 'Identifier' &&
                    callee.object.name === 'console' &&
                    callee.property.type === 'Identifier' &&
                    ['log', 'debug', 'trace'].includes(callee.property.name) &&
                    !path.scope.getBinding('console')
                ) {
                    const loc = path.node.loc;
                    if (loc) found.push({ start: loc.start.line, end: loc.end.line, reason: `Debug \`console.${callee.property.name}\`` });
                }
            },
        });
        return found.sort((a, b) => a.start - b.start);
    }

    detectMagicNumbers(code: string): MagicNumber[] {
        let ast: t.File;
        try {
            ast = this.parse(code);
        } catch {
            return [];
        }
        const lines = code.split('\n');
        const found: MagicNumber[] = [];

        traverse(ast, {
            NumericLiteral(path) {
                let node: t.Node = path.node;
                let p: NodePath = path;
                let value = path.node.value;
                if (p.parentPath?.isUnaryExpression({ operator: '-' })) {
                    p = p.parentPath;
                    node = p.node;
                    value = -value;
                }
                if ([-1, 0, 1, 2].includes(value)) return;
                const parent = p.parentPath;
                if (!parent) return;

                // Already named or self-describing contexts.
                if (parent.isVariableDeclarator() || parent.isObjectProperty() || parent.isClassProperty()) return;
                if (parent.isAssignmentPattern() || parent.isTSEnumMember?.()) return;
                if (parent.isAssignmentExpression({ operator: '=' }) && parent.node.right === node) return;
                if (parent.isMemberExpression() && parent.node.computed && parent.node.property === node) return;
                if (p.findParent(a => a.isTSType?.() || a.isTSEnumDeclaration?.())) return;
                if (parent.isCallExpression()) {
                    const callee = parent.node.callee;
                    const calleeName = callee.type === 'Identifier' ? callee.name : callee.type === 'MemberExpression' && callee.property.type === 'Identifier' ? callee.property.name : '';
                    if (['parseInt', 'toFixed', 'toString', 'slice', 'substring', 'substr', 'padStart', 'padEnd', 'splice', 'at', 'repeat', 'toPrecision', 'round', 'pow'].includes(calleeName)) return;
                }

                const loc = node.loc;
                if (!loc) return;
                const info: MagicNumber = {
                    value,
                    raw: code.slice(node.start!, node.end!),
                    line: loc.start.line,
                    column: loc.start.column,
                    lineText: lines[loc.start.line - 1]?.trim() ?? '',
                };

                if (parent.isBinaryExpression() && ['<', '<=', '>', '>=', '===', '!==', '==', '!='].includes(parent.node.operator)) {
                    const other = parent.node.left === node ? parent.node.right : parent.node.left;
                    info.usage = 'compare';
                    info.hint = exprName(other);
                    if (info.hint && /status|code/i.test(info.hint)) info.usage = 'status';
                } else if (parent.isBinaryExpression() || parent.isAssignmentExpression()) {
                    if (Math.abs(value) <= 10 && Number.isInteger(value)) return;
                    info.usage = 'arithmetic';
                    info.operator = (parent.node as t.BinaryExpression | t.AssignmentExpression).operator;
                    const other = parent.isBinaryExpression()
                        ? (parent.node.left === node ? parent.node.right : parent.node.left)
                        : (parent.node as t.AssignmentExpression).left;
                    info.hint = exprName(other as t.Node);
                } else if (parent.isCallExpression()) {
                    const callee = parent.node.callee;
                    const calleeName = callee.type === 'Identifier' ? callee.name : callee.type === 'MemberExpression' && callee.property.type === 'Identifier' ? callee.property.name : '';
                    info.usage = /^(setTimeout|setInterval|delay|sleep|wait)$/.test(calleeName) ? 'timer' : 'argument';
                    info.hint = calleeName || undefined;
                } else {
                    info.usage = 'other';
                    if (Math.abs(value) <= 10) return;
                }
                found.push(info);
            },
        });
        return found;
    }

    detectNestedConditionals(code: string, maxDepth: number): NestedConditional[] {
        let ast: t.File;
        try {
            ast = this.parse(code);
        } catch {
            return [];
        }
        // For each outermost `if`, remember the deepest chain of nested ifs beneath it.
        const deepest = new Map<t.Node, NodePath<t.IfStatement>[]>();

        traverse(ast, {
            IfStatement(path) {
                const chain: NodePath<t.IfStatement>[] = [path];
                let cur: NodePath | null = path.parentPath;
                while (cur && !cur.isFunction() && !cur.isProgram()) {
                    // `else if` continues a chain rather than nesting deeper.
                    if (cur.isIfStatement() && cur.node.alternate !== chain[0].node) chain.unshift(cur);
                    else if (cur.isIfStatement()) chain[0] = cur;
                    cur = cur.parentPath;
                }
                if (chain.length <= maxDepth) return;
                const root = chain[0].node;
                const prev = deepest.get(root);
                if (!prev || chain.length > prev.length) deepest.set(root, chain);
            },
        });

        const results: NestedConditional[] = [];
        for (const chain of deepest.values()) {
            const root = chain[0];
            const pure = chain.every((p, i) => {
                if (p.node.alternate) return false;
                if (i === chain.length - 1) return true;
                const cons = p.node.consequent;
                const only = cons.type === 'BlockStatement' ? (cons.body.length === 1 ? cons.body[0] : null) : cons;
                return only === chain[i + 1].node;
            });
            const block = root.parentPath;
            const inFunction = !!block?.isBlockStatement() && !!block.parentPath?.isFunction();
            let tail: NestedConditional['tail'] = 'other';
            let tailReturn: string | undefined;
            if (inFunction && Array.isArray(root.container)) {
                const siblings = root.container as t.Statement[];
                const rest = siblings.slice(siblings.indexOf(root.node) + 1);
                if (rest.length === 0) tail = 'empty';
                else if (rest.length === 1 && rest[0].type === 'ReturnStatement') {
                    tail = 'return';
                    tailReturn = code.slice(rest[0].start!, rest[0].end!).replace(/;?\s*$/, ';');
                }
            }
            const cons = chain[chain.length - 1].node.consequent;
            const stmts = cons.type === 'BlockStatement' ? cons.body : [cons];
            const body = stmts.length
                ? dedentText(code.slice(code.lastIndexOf('\n', stmts[0].start! - 1) + 1, stmts[stmts.length - 1].end!))
                : '';
            results.push({
                depth: chain.length,
                startLine: root.node.loc!.start.line,
                endLine: root.node.loc!.end.line,
                conditions: chain.map(p => code.slice(p.node.test.start!, p.node.test.end!)),
                body,
                pure,
                guardable: pure && inFunction && tail !== 'other',
                tail,
                tailReturn,
            });
        }
        return results.sort((a, b) => a.startLine - b.startLine);
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function bindingKind(binding: Binding): IdentifierKind {
    if (binding.kind === 'param') return 'parameter';
    if (binding.path.isClassDeclaration() || binding.path.isClassExpression()) return 'class';
    if (binding.path.isFunctionDeclaration() || binding.path.isFunctionExpression()) return 'function';
    if (binding.path.isVariableDeclarator()) {
        const init = binding.path.node.init;
        if (init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')) return 'function';
    }
    return 'variable';
}

function isLoopIndex(binding: Binding): boolean {
    if (!LOOP_INDEX_NAMES.has(binding.identifier.name)) return false;
    const decl = binding.path.parentPath;
    return !!decl?.parentPath?.isForStatement();
}

function isParameterProperty(binding: Binding): boolean {
    return !!binding.path.findParent(p => p.isTSParameterProperty?.() ?? false) || binding.path.isTSParameterProperty?.() === true;
}

function exprName(node: t.Node | null | undefined): string | undefined {
    if (!node) return undefined;
    if (node.type === 'Identifier') return node.name;
    if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') && !node.computed && node.property.type === 'Identifier') {
        return node.property.name;
    }
    if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') && node.property.type === 'StringLiteral') {
        return node.property.value;
    }
    if (node.type === 'CallExpression') return exprName(node.callee as t.Node);
    return undefined;
}

/** Name hinted by a variable initializer, e.g. `user.name` → `name`, `getUser()` → `user`. */
function nameFromInit(init: t.Node | null | undefined): string | undefined {
    if (!init) return undefined;
    if (init.type === 'AwaitExpression') return nameFromInit(init.argument);
    if (init.type === 'TSAsExpression' || init.type === 'TSNonNullExpression') return nameFromInit(init.expression);
    if (init.type === 'MemberExpression' || init.type === 'OptionalMemberExpression') {
        const name = exprName(init);
        if (name && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) return toCamelCase(name);
        return undefined;
    }
    if (init.type === 'NewExpression' && init.callee.type === 'Identifier' && /^[A-Z]/.test(init.callee.name)) {
        return toCamelCase(init.callee.name);
    }
    if (init.type === 'CallExpression' || init.type === 'OptionalCallExpression') {
        const callee = init.callee;
        const fnName = exprName(callee as t.Node);
        if (!fnName) return undefined;
        if (fnName === 'fetch') return 'response';
        if (/^(readFile|readFileSync)$/.test(fnName)) return 'contents';
        if (/^(getElementById|querySelector|createElement|closest)$/.test(fnName)) return 'element';
        if (/^(querySelectorAll|getElementsBy\w+)$/.test(fnName)) return 'elements';
        if (fnName === 'parse' && callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'JSON') return 'data';
        // `await response.json()`
        if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier' && callee.property.name === 'json' && init.arguments.length === 0) return 'data';
        const m = fnName.match(GETTER_VERB);
        if (m) {
            const rest = fnName.slice(m[1].length);
            return rest ? toCamelCase(rest) : undefined;
        }
    }
    return undefined;
}

/** The binding is a plain `const x = …` (not destructured). */
function isSimpleDeclarator(binding: Binding): boolean {
    const path = binding.path;
    return path.isVariableDeclarator() && path.node.id.type === 'Identifier' && path.node.id.name === binding.identifier.name;
}

/** `const res = await fetch(…)`: a short name that abbreviates what it holds (res → response). */
function isShortFormOfInit(name: string, binding: Binding, minNameLength: number): boolean {
    if (minNameLength <= 1 || name.startsWith('_') || name.startsWith('$') || name.length > 4) return false;
    if (!isSimpleDeclarator(binding)) return false;
    const fromInit = nameFromInit((binding.path.node as t.VariableDeclarator).init);
    return !!fromInit && fromInit.length > name.length && fromInit.toLowerCase().startsWith(name.toLowerCase());
}

function hintsFor(binding: Binding): IdentifierHints {
    const hints: IdentifierHints = {};
    const path = binding.path;

    // Properties read off this identifier.
    const props = new Set<string>();
    for (const ref of binding.referencePaths) {
        const parent = ref.parentPath;
        if (parent?.isMemberExpression() && parent.node.object === ref.node && !parent.node.computed && parent.node.property.type === 'Identifier') {
            props.add(parent.node.property.name);
        }
    }
    if (props.size) hints.usedProperties = [...props].slice(0, 8);

    // Destructured bindings (`const { n } = user`) hold a property of the
    // initializer, not the initializer itself, so its name is no evidence.
    if (path.isVariableDeclarator() && isSimpleDeclarator(binding)) {
        const init = path.node.init;
        const fromInit = nameFromInit(init);
        if (fromInit) hints.initFrom = fromInit;

        const forOf = path.parentPath?.parentPath;
        if (forOf?.isForOfStatement() && forOf.node.left === path.parentPath!.node) {
            const coll = exprName(forOf.node.right);
            if (coll) hints.iterates = coll;
        }

        const violations = binding.constantViolations.map(v => v.node);
        const compoundAdds = violations.filter(v => v.type === 'AssignmentExpression' && v.operator === '+=').length;
        const increments = violations.filter(v => v.type === 'UpdateExpression').length;
        if (init?.type === 'NumericLiteral' && init.value === 0) {
            if (compoundAdds > 0) hints.role = 'accumulator';
            else if (increments > 0) hints.role = 'counter';
        } else if (init?.type === 'StringLiteral' && init.value === '' && compoundAdds > 0) {
            hints.role = 'text';
        } else if (init?.type === 'ArrayExpression' && init.elements.length === 0) {
            const pushed = binding.referencePaths.some(r => {
                const parent = r.parentPath;
                return parent?.isMemberExpression() && parent.node.property.type === 'Identifier' && parent.node.property.name === 'push';
            });
            if (pushed) hints.role = 'items';
        }
    }

    if (!hints.role && binding.referencePaths.length === 1 && binding.referencePaths[0].parentPath?.isReturnStatement() && isSimpleDeclarator(binding)) {
        hints.role = 'result';
    }

    if (binding.kind === 'param') {
        const fn = binding.scope.path;
        if (fn.isFunction()) {
            const fnNode = fn.node as t.Function;
            const index = fnNode.params.indexOf(binding.path.node as any);
            const call = fn.parentPath;
            if (call?.isCallExpression() && call.node.arguments[0] === fnNode) {
                const callee = call.node.callee;
                if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
                    const method = callee.property.name;
                    const coll = exprName(callee.object);
                    if (ITERATOR_METHODS.has(method) && index === 0 && coll) hints.iterates = coll;
                    if (method === 'reduce' && index === 1 && coll) hints.iterates = coll;
                    if (method === 'reduce' && index === 0) hints.role = 'accumulator';
                    if (method === 'addEventListener' || /^on[A-Z]/.test(method)) hints.role = 'event';
                }
            }
            if (call?.isCallExpression() && call.node.arguments[1] === fnNode) {
                const callee = call.node.callee;
                if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier' && callee.property.name === 'addEventListener' && index === 0) {
                    hints.role = 'event';
                }
            }
        }
    }
    const scopePath = binding.scope.path;
    if (binding.path.isCatchClause() || (scopePath.isCatchClause() && scopePath.node.param === binding.identifier)) {
        hints.role = 'error';
    }
    return hints;
}

function contextFor(code: string, binding: Binding): string {
    const fn = binding.scope.getFunctionParent()?.path ?? binding.scope.path;
    const start = fn.node.start ?? 0;
    const end = fn.node.end ?? code.length;
    const text = code.slice(start, end);
    return text.length > 1200 ? text.slice(0, 1200) + '\n…' : text;
}

interface Site {
    start: number;
    end: number;
    shorthand: boolean;
}

/** Every source location that must change when `binding` is renamed. */
function renameSites(binding: Binding): Site[] {
    const sites: Site[] = [];
    const name = binding.identifier.name;
    const visit = (path: NodePath<t.Identifier | t.JSXIdentifier>) => {
        const node = path.node;
        if (node.name !== name || node.start == null || node.end == null) return;
        const p = path as NodePath;
        const isRef = p.isReferencedIdentifier() || p.isBindingIdentifier() || p.parentPath?.isTSTypeQuery();
        if (!isRef) return;
        if (path.scope.getBinding(name) !== binding) return;
        const parent = path.parent;
        let shorthand = false;
        if (parent.type === 'ObjectProperty' && parent.shorthand && parent.value === node) shorthand = true;
        if (parent.type === 'AssignmentPattern' && parent.left === node) {
            const gp = path.parentPath?.parent;
            if (gp?.type === 'ObjectProperty' && gp.shorthand && gp.value === parent) shorthand = true;
        }
        // In TypeScript an identifier's range includes its type annotation (`r: string[]`),
        // so only replace the name itself.
        sites.push({ start: node.start, end: node.start + name.length, shorthand });
    };
    const root = binding.scope.path;
    if (root.isIdentifier()) visit(root as NodePath<t.Identifier>);
    root.traverse({ Identifier: visit, JSXIdentifier: visit });
    // A function/class expression's own name lives on the node itself.
    const own = (root.node as any).id as t.Identifier | undefined;
    if (own && own.name === name && own === binding.identifier && own.start != null) {
        sites.push({ start: own.start, end: own.start + name.length, shorthand: false });
    }
    // Parameters of the scope's own function are children, so they're covered by traverse.
    return sites;
}

/** Reason a rename would be unsafe, or null if it's fine. */
function findConflict(binding: Binding, newName: string): string | null {
    const scope = binding.scope;
    if (scope.hasOwnBinding(newName)) return `"${newName}" already exists in this scope`;
    let clash: string | null = null;
    const check = (path: NodePath<t.Identifier | t.JSXIdentifier>) => {
        if (clash || path.node.name !== newName) return;
        const p = path as NodePath;
        if (p.isReferencedIdentifier() || p.isBindingIdentifier()) {
            clash = `"${newName}" is already used nearby`;
            path.stop();
        }
    };
    scope.path.traverse({ Identifier: check, JSXIdentifier: check });
    return clash;
}

function applyEdits(code: string, edits: Array<{ start: number; end: number; text: string }>): string {
    const byStart = new Map<number, { start: number; end: number; text: string }>();
    for (const e of edits) {
        const prev = byStart.get(e.start);
        if (!prev || e.text.length > prev.text.length) byStart.set(e.start, e);
    }
    const sorted = [...byStart.values()].sort((a, b) => b.start - a.start);
    let out = code;
    for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    return out;
}

function paramName(p: t.Node): string {
    switch (p.type) {
        case 'Identifier': return p.name;
        case 'AssignmentPattern': return paramName(p.left);
        case 'RestElement': return `...${paramName(p.argument)}`;
        case 'ObjectPattern': return 'options';
        case 'ArrayPattern': return 'values';
        case 'TSParameterProperty': return paramName(p.parameter);
        default: return 'arg';
    }
}

function returnsValue(fnPath: NodePath<t.Function>): boolean {
    const fn = fnPath.node;
    if (fn.type === 'ArrowFunctionExpression' && fn.body.type !== 'BlockStatement') return true;
    let found = false;
    fnPath.traverse({
        ReturnStatement(p) {
            if (p.node.argument) {
                found = true;
                p.stop();
            }
        },
        Function(p) { p.skip(); },
    });
    return found;
}

function functionTraits(fnPath: NodePath<t.Function>): string[] {
    const traits = new Set<string>();
    if (fnPath.node.async) traits.add('async');
    if (fnPath.node.generator) traits.add('generator');
    fnPath.traverse({
        ThrowStatement() { traits.add('throws'); },
        CallExpression(p) {
            const name = exprName(p.node.callee as t.Node) ?? '';
            const callee = p.node.callee;
            const objectName = callee.type === 'MemberExpression' && callee.object.type === 'Identifier' ? callee.object.name : '';
            if (objectName === 'console') traits.add('logs');
            if (name === 'fetch' || /^(axios|http|https|got|ky|superagent)$/.test(objectName) || (callee.type === 'Identifier' && callee.name === 'axios')) traits.add('network');
            if (/^(setTimeout|setInterval)$/.test(name)) traits.add('timers');
            if (/^(writeFile|writeFileSync|appendFile|readFile|readFileSync|unlink|mkdir)$/.test(name)) traits.add('filesystem');
        },
        AssignmentExpression(p) {
            const left = p.node.left;
            if (left.type === 'MemberExpression' && left.object.type === 'ThisExpression') traits.add('mutates-this');
        },
        Function(p) { p.skip(); },
    });
    return [...traits];
}

const IGNORED_KEYS = new Set(['start', 'end', 'loc', 'range', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens', 'shorthand']);

/** Structural equality of two ASTs where identifiers may differ only by an applied rename. */
function sameShape(a: any, b: any, pairs: Set<string>): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null) return false;
    if (typeof a !== 'object') return a === b;
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        return a.every((x, i) => sameShape(x, b[i], pairs));
    }
    if (a.type !== b.type) return false;
    if ((a.type === 'Identifier' || a.type === 'JSXIdentifier') && a.name !== b.name && !pairs.has(`${a.name}\u0000${b.name}`)) return false;
    // A shorthand property `{ n }` legitimately becomes `{ n: name }`.
    if (a.type === 'ObjectProperty' && a.shorthand && !b.shorthand) {
        return sameShape(a.key, b.key, new Set()) && sameShape(a.value, b.value, pairs);
    }
    const none = new Set<string>();
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (IGNORED_KEYS.has(key)) continue;
        if (key === 'name' && (a.type === 'Identifier' || a.type === 'JSXIdentifier')) continue;
        // Property names (`{ key: … }`, `obj.prop`) must never change.
        const strict = !a.computed && (key === 'key' || (key === 'property' && /MemberExpression$/.test(a.type)));
        if (!sameShape(a[key], b[key], strict ? none : pairs)) return false;
    }
    return true;
}

function dedentText(text: string): string {
    const lines = text.split('\n');
    const indents = lines.filter(l => l.trim()).map(l => l.match(/^\s*/)![0].length);
    const min = indents.length ? Math.min(...indents) : 0;
    return lines.map(l => l.slice(min)).join('\n');
}

/** Insert `/** … *\/` comments above the given lines, matching indentation. */
export function insertBlockComments(code: string, docs: Array<{ fn: FunctionInfo; text: string }>): string {
    const lines = code.split('\n');
    const sorted = [...docs].sort((a, b) => b.fn.line - a.fn.line);
    for (const { fn, text } of sorted) {
        const idx = fn.line - 1;
        if (idx < 0 || idx >= lines.length) continue;
        const indent = lines[idx].match(/^\s*/)?.[0] ?? '';
        const safe = text.replace(/\*\//g, '*\\/');
        const body = safe.split('\n').map(l => (l ? `${indent} * ${l}` : `${indent} *`));
        const comment = safe.includes('\n') ? [`${indent}/**`, ...body, `${indent} */`] : [`${indent}/** ${safe} */`];
        lines.splice(idx, 0, ...comment);
    }
    return lines.join('\n');
}
