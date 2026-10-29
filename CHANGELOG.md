# Changelog

## 5.0.0 — 2026-10-29

A rewrite focused on making every change safe and every suggestion correct.

### Safety
- Renames use real scope analysis (Babel for JS/TS, a tokenizer for Python). Only local variables are renamed; exports, globals, parameters in Python, object keys and attributes are never touched.
- Every rename is checked: the code is parsed again and compared with the original. If anything other than the renamed identifiers changed, all renames for that file are reverted.
- Shorthand properties are expanded (`{ n }` → `{ n: name }`) so object shapes stay the same, and TypeScript type annotations are kept.
- Files that don't parse are left alone, and output that doesn't parse is never written.
- Python validation uses `python3 -c "import ast"`; Java formatting and validation use `prettier-plugin-java`.

### CLI
- Preview is now the default. `--write` applies changes, `--check` exits 1 for CI, `--stdout` and `--json` for tooling, `-` reads stdin.
- Directories are expanded (respecting `.gitignore`), with a per-file status and summary.
- New commands: `doctor`, `init`, `styles`, `watch`, `hook install|uninstall`.
- Config file support: `.prismifyrc.json`, `.prismifyrc`, `prismify.config.json` or a `"prismify"` key in `package.json`. Prettier config and `pyproject.toml` formatter settings are respected.

### Naming
- Offline heuristics now only rename when there is evidence: the initializer (`const n = user.name` → `name`), loop collections (`for (x of users)` → `user`), accumulators, counters, catch clauses, event handlers and return values.
- Ollama: auto-picks an installed code model, batches requests, and only applies a name when a majority of runs agree (`--ai-checks`). Heuristics fill any gaps.

### Docs and analysis
- `--explain` adds doc comments only to undocumented functions (JSDoc, Python docstrings, Javadoc).
- `--refactor` suggests named constants for magic numbers (with context-aware names) and guard clauses for deeply nested conditionals, with correct indentation and condition negation.
- `--dead-code` reports unreachable code and leftover debug statements.
- Python formatting uses `ruff` or `black` when installed, with a built-in whitespace formatter as a fallback.

### Other
- New Java style profile; the Python profile uses double quotes (PEP 8 / black).
- Library API: `import { BeautifyEngine } from 'prismify'`.
- VS Code extension rewritten: edits are applied in the editor (undoable), with format-on-save and a refactoring panel.
- 60 tests (Vitest) and GitHub Actions CI on Linux and macOS.

## 4.0.0

Initial public version.
