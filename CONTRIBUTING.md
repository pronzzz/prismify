# Contributing to Prismify

Thanks for helping out. Bug reports with a small code sample that Prismify handles badly are especially useful.

## Development setup

```bash
git clone https://github.com/pronzzz/prismify.git
cd prismify
npm install        # also builds dist/ via the prepare script

npm run dev -- examples/messy.js      # run the CLI from source (tsx)
npm test                              # Vitest
npm run typecheck
npm run build                         # compile to dist/
```

Python tests need `python3` on your PATH. They use Prismify's built-in Python formatter so results don't depend on whether you have ruff or black installed.

## Project layout

See [GUIDE.md](GUIDE.md) for how the pipeline fits together.

## Rules for changes

- **Never break code.** Anything that edits source must keep it parsing, and renames must pass the shape check in `src/languages/*.ts`. If you're not sure a change is safe, skip it and report a suggestion instead.
- **Evidence over guesses.** A heuristic rename needs a reason the user can read (`assigned from \`name\``). Don't add renames based on a single letter alone.
- Add a test for every bug fix and new rule. Tests live in `tests/` and use the helpers in `tests/helpers.ts`.

## Adding a language

1. Create `src/languages/<language>.ts` implementing `LanguagePlugin` from `src/types/index.ts`.
2. Register it in `src/languages/index.ts` (extensions and `getPlugin`).
3. Set `canRename = false` until you have scope analysis and a post-rename check.
4. Add a style profile in `src/styles/profiles.ts` and an example in `examples/`.

## Pull requests

1. Branch from `main`.
2. Keep `npm test` and `npm run typecheck` passing.
3. Update the README and CHANGELOG when behaviour changes.
