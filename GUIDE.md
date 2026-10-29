# Prismify technical guide

How Prismify works inside, for contributors and anyone using it as a library.

## Pipeline

`BeautifyEngine.beautify(code, filePath, options)` in `src/core/engine.ts` runs these steps for each file:

```
 input ──▶ 1. validate ──▶ 2. rename ──▶ 3. re-validate ──▶ 4. docs ──▶ 5. format ──▶ 6. final validate ──▶ output
                                                                                                │
                                                                     7. analysis (suggestions, dead code; never applied)
```

1. **Validate input.** If the file doesn't parse, Prismify stops and reports the error. It never "fixes" broken code.
2. **Rename.** The language plugin lists local identifiers with *hints* (what they're assigned from, whether they're loop variables, accumulators, and so on). The naming provider suggests names; suggestions below `--confidence` are dropped. The plugin applies the renames and checks them (see *Rename safety*).
3. **Re-validate.** If the renamed code doesn't parse, the renames are reverted.
4. **Docs** (`--explain`). Undocumented functions get a doc comment. If the result doesn't parse, the docs are dropped.
5. **Format.** Prettier for JS/TS, `prettier-plugin-java` for Java, and `ruff`, `black` or the built-in formatter for Python.
6. **Final validate.** Output that doesn't parse is rejected and the original is kept.
7. **Analysis** (`--refactor`, `--dead-code`). These are reported, never applied.

## Rename safety

### JavaScript / TypeScript (`src/languages/javascript.ts`)

- Parses with `@babel/parser` (TypeScript and JSX plugins when the file needs them) and uses `@babel/traverse` scope analysis.
- Only bindings in a function or block scope are candidates. Top-level names, exports, imports, class members and object keys are never renamed.
- Skips any scope that uses `eval` or `with`.
- Before renaming, checks that the new name doesn't collide with another binding visible at any reference site and wouldn't shadow a name used inside.
- Edits are spliced by source offset, replacing only the identifier text, so type annotations and comments stay as they are. Shorthand properties are expanded (`{ n }` → `{ n: name }`).
- After renaming, the new AST is compared node by node with the old one (`sameShape`). Only identifiers may differ, and only by one of the applied rename pairs. Any other difference reverts every rename in the file.

### Python (`src/languages/python.ts`, `python-tokens.ts`)

- A tokenizer that understands strings, f-strings (including `{expr}` fields), comments and bracket depth.
- Only variables assigned inside a function are candidates. Parameters (callers may pass them by keyword), attributes, keyword arguments, `global`/`nonlocal` names and functions that use `locals()`, `vars()`, `eval` or `exec` are skipped.
- After renaming, the token streams are compared; only the renamed names may differ.

### Java

Java isn't renamed yet: there's no scope analysis for it. It is formatted, documented and analysed.

## Naming providers (`src/ai/`)

| Provider | When | How |
| --- | --- | --- |
| `heuristic` | Always available; used offline | Rules based on evidence: initializer property (`user.name` → `name`), `fetch()` → `response`, loops over `users` → `user`, accumulators → `total`, counters → `count`, catch → `error`, sole return value → `result`, plus an abbreviation list (`idx` → `index`). |
| `ollama` | When an Ollama server is reachable | Sends batches of up to 12 identifiers with their context and asks for JSON. Runs the prompt `--ai-checks` times (default 3); a name is used only if at least 60% of runs agree. Confidence is the agreement × the model's own confidence. Heuristics fill in anything the model skips. |
| `auto` | Default | `ollama` if reachable, otherwise `heuristic`. |

Every suggested name is checked against reserved words and naming conventions (`camelCase` for JS/TS/Java, `snake_case` for Python) before it can be applied.

## Analysis (`src/analysis/refactor.ts`)

- **Magic numbers.** Numeric literals outside constant declarations, with a name based on context: time values in milliseconds (`86400000` → `ONE_DAY_MS`), HTTP statuses, comparisons (`age < 18` → `AGE_THRESHOLD`), multipliers (`price * 1.08` → `PRICE_MULTIPLIER`), timers (`setTimeout(fn, 500)` → `DELAY_MS`).
- **Deep nesting.** Chains of nested `if`s three or more deep. When the conditions have no side effects and nothing follows them, Prismify suggests guard clauses with the conditions negated correctly (`a > 0` → `a <= 0`). Otherwise it suggests a combined `&&` condition or just describes the problem.
- **Dead code.** Statements after `return`/`throw`/`break` and debug leftovers (`console.log`, `debugger`, `print`, `breakpoint()`, `System.out.println`).

## Style profiles (`src/styles/`)

Profiles set indentation, quotes, semicolons, line width and the minimum name length that triggers a rename. `minimal` and `competitive` turn length-based renames off. `--detect-style` reads the file and overrides the profile with its existing indentation, quotes and semicolons. A project's Prettier config or `pyproject.toml` formatter settings win over the profile unless you pass `--no-project-config`.

## Library use

```ts
import { BeautifyEngine, createProvider, getProfile } from 'prismify';

const { provider } = await createProvider('auto');
const engine = new BeautifyEngine({ provider });
const result = await engine.beautify(source, 'src/app.ts', {
    profile: getProfile('airbnb'),
    rename: true,
    format: true,
    explain: false,
    refactor: true,
});

result.beautified;   // the new code
result.renames;      // [{ from, to, line, reason, confidence, source }]
result.suggestions;  // refactoring suggestions (not applied)
```

## Source map

| Path | What's there |
| --- | --- |
| `src/cli.ts` | Commander CLI and subcommands |
| `src/core/engine.ts` | The pipeline above |
| `src/core/config.ts` | Config file discovery and validation |
| `src/core/files.ts` | Path expansion, `.gitignore` handling |
| `src/core/naming.ts` | Case conversion, reserved words, singularisation |
| `src/languages/` | Language plugins |
| `src/ai/` | Heuristic and Ollama providers |
| `src/explain/docs.ts` | Doc comment generation |
| `src/analysis/refactor.ts` | Magic numbers and nesting suggestions |
| `src/output/` | Diff rendering and terminal reports |
| `src/integration/` | Git hook and watch mode |
| `vscode-extension/` | VS Code extension |
