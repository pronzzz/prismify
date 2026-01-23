# Contributing to Prismify

Thank you for your interest in contributing to Prismify!

## Development Setup

```bash
# Clone the repo
git clone <repo-url>
cd beautify-code

# Install dependencies
npm install

# Run in development mode
npm run dev -- ./file.js --preview
```

## Code Style

- TypeScript with strict mode
- Airbnb-inspired naming conventions
- Modular architecture

## Adding a New Language

1. Create `src/languages/<language>.ts`
2. Extend `BaseLanguagePlugin`
3. Implement: `extractIdentifiers()`, `format()`, `validate()`
4. Register in `src/languages/index.ts`

## Testing

```bash
npm test
```

## Pull Request Guidelines

1. Create a feature branch
2. Write tests for new features
3. Ensure all tests pass
4. Update documentation
5. Submit PR with clear description
