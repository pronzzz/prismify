# 📚 Prismify Technical Guide

A comprehensive guide to understanding and extending Prismify.

---

## Architecture Overview

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   CLI       │────▶│   Engine     │────▶│   Output    │
│  (index.ts) │     │ (engine.ts)  │     │  (diff.ts)  │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌───────────┐   ┌───────────┐   ┌───────────┐
    │ Language  │   │    AI     │   │ Analysis  │
    │  Plugins  │   │ Provider  │   │  Modules  │
    └───────────┘   └───────────┘   └───────────┘
```

---

## Core Components

### 1. CLI (`src/index.ts`)

The command-line interface using Commander.js.

```typescript
program
  .option('--preview', 'Preview mode')
  .option('--refactor', 'Enable refactoring')
  .option('--explain', 'Add comments')
  .option('--detect-style', 'Auto-detect style')
```

### 2. Engine (`src/core/engine.ts`)

Main orchestration:
1. Detect language from file extension
2. Extract identifiers using language plugin
3. Get AI naming suggestions
4. Apply formatting
5. Validate output syntax
6. Generate diff

### 3. Language Plugins (`src/languages/`)

Each plugin implements:
- `extractIdentifiers()` - Find variables, functions, classes
- `format()` - Apply language-specific formatting
- `validate()` - Check syntax validity

**Supported:**
- JavaScript/TypeScript (Babel + Prettier)
- Python (Regex + PEP 8 rules)
- Java (Regex + Java conventions)

### 4. AI Provider (`src/ai/`)

#### Ollama Provider
Uses local LLM for naming suggestions with anti-hallucination:
- Low temperature (0.1)
- 3x consistency checks
- Output validation
- Confidence scoring

#### Mock Provider
Heuristic-based fallback:
- Expands abbreviations (e.g., `x` → `xCoord`)
- Follows naming conventions
- No LLM required

### 5. Analysis Modules (`src/analysis/`)

#### Magic Numbers (`constants.ts`)
Detects numeric literals and suggests names:
- Known constants (HTTP codes, time values)
- Context-aware suggestions via AI

#### Conditionals (`conditionals.ts`)
Detects deeply nested if statements:
- Suggests early return patterns
- Configurable max depth threshold

### 6. Explainer (`src/explain/`)

Generates AI comments in 3 modes:
- **Beginner**: Detailed, friendly explanations
- **PR Review**: Focus on risks/changes
- **Production**: Minimal one-liners

### 7. Style Profiles (`src/styles/`)

#### Built-in Profiles
- `google` - Google JS Style
- `airbnb` - Airbnb Style (default)
- `minimal` - Low intervention
- `python` - PEP 8
- `competitive` - Short names OK

#### Style Detection
Analyzes existing code for:
- Naming convention (camelCase, snake_case)
- Indentation (2/4 spaces, tabs)
- Quote style (single/double)
- Semicolon usage

---

## Adding a New Language

1. Create `src/languages/newlang.ts`:

```typescript
import { BaseLanguagePlugin } from './base.js';

export class NewLangPlugin extends BaseLanguagePlugin {
  language = 'newlang';
  
  extractIdentifiers(code: string) {
    // Parse and return identifiers
  }
  
  async format(code: string) {
    // Apply formatting
  }
  
  validate(code: string) {
    // Check syntax
  }
}
```

2. Register in `src/languages/index.ts`

3. Add tests in `tests/`

---

## Configuration

### Environment Variables

```bash
OLLAMA_HOST=http://localhost:11434  # Ollama server
OLLAMA_MODEL=codellama              # Model to use
```

### CLI Defaults

Edit `src/types/index.ts` for default options.

---

## Testing

```bash
# Run all tests
npm test

# Test with fixtures
npm run dev -- ./tests/fixtures/messy.js --preview -v
```

---

## Performance

Typical processing times:
- Small files (<100 lines): ~30-50ms
- Medium files (100-500 lines): ~100-200ms
- AI suggestions: +500-2000ms (with Ollama)

---

## Troubleshooting

### "traverse is not a function"
Babel ESM/CJS interop issue. Fixed in `javascript.ts`.

### Ollama not responding
```bash
ollama serve
ollama pull codellama
```

### Style detection low confidence
Add more code to analyze - detection improves with larger files.
