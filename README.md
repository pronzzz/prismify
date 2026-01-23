# 🔮 Prismify

**AI-Powered Code Beautification** that goes beyond syntax formatting.

[![npm version](https://img.shields.io/badge/npm-v4.0.0-blue)](https://www.npmjs.com/package/prismify)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Ollama](https://img.shields.io/badge/AI-Ollama-purple)](https://ollama.ai/)
[![VS Code Ready](https://img.shields.io/badge/VS%20Code-Extension-007ACC)](vscode-extension/)

> Transform messy code into clean, readable, well-documented code using AI-powered analysis.

---

## ✨ Features

| Feature | Description | CLI Flag |
|---------|-------------|----------|
| 🎨 **Smart Formatting** | Prettier (JS/TS), PEP 8 (Python) | `--preview` |
| 🧠 **AI Renaming** | Improve variable/function names via Ollama | `--provider ollama` |
| 🔢 **Magic Numbers** | Detect and suggest named constants | `--refactor` |
| 📊 **Conditionals** | Suggest early returns for nested code | `--refactor` |
| 📝 **Explanations** | AI-generated comments | `--explain` |
| 🎭 **Style Profiles** | Google, Airbnb, Minimal, Python | `--style` |
| 🔍 **Style Detection** | Auto-detect existing code style | `--detect-style` |

---

## 🚀 Quick Start

```bash
# Clone and install
git clone https://github.com/pronzzz/prismify.git
cd prismify
npm install

# Basic beautification
npm run dev -- ./file.js --preview

# With AI renaming (requires Ollama)
ollama serve && ollama pull codellama
npm run dev -- ./file.js --preview
```

---

## 📖 Usage Examples

### Basic Beautification
```bash
npm run dev -- ./messy.js --preview
```

### With Refactoring Analysis
```bash
npm run dev -- ./messy.js --refactor --preview -v
```

### Add Explanatory Comments
```bash
npm run dev -- ./messy.js --explain --explain-level beginner --preview
```

### Auto-Detect Style
```bash
npm run dev -- ./messy.js --detect-style --preview
```

### All Features Combined
```bash
npm run dev -- ./messy.js --refactor --explain --detect-style --preview -v
```

---

## 🎭 Style Profiles

| Profile | Description |
|---------|-------------|
| `google` | Google JavaScript Style Guide |
| `airbnb` | Airbnb Style Guide (default) |
| `minimal` | Low intervention |
| `python` | PEP 8 |
| `competitive` | Short variable names OK |

```bash
npm run dev -- ./file.js --style google --preview
```

---

## 🛡️ Anti-Hallucination

AI naming suggestions use multiple safeguards:

| Measure | Value |
|---------|-------|
| Temperature | 0.1 (deterministic) |
| Consistency | 3x checks, 67% agreement |
| Confidence | Only apply >70% |
| Validation | Must be valid identifier |

---

## 📁 Project Structure

```
prismify/
├── src/
│   ├── index.ts          # CLI entry point (v4.0.0)
│   ├── core/             # Beautification engine
│   ├── ai/               # Ollama AI provider
│   ├── analysis/         # Refactoring (magic numbers, conditionals)
│   ├── explain/          # Comment generation
│   ├── styles/           # Profiles & detection
│   └── integration/      # Git hooks, watchers
├── vscode-extension/     # VS Code extension scaffold
├── tests/fixtures/       # Sample messy files
├── GUIDE.md              # Detailed technical guide
├── CONTRIBUTING.md       # Contribution guidelines
└── LICENSE               # MIT License
```

---

## 🔌 VS Code Extension

```bash
cd vscode-extension
npm install
npm run compile
```

**Commands:**
- `Prismify: Beautify Current File`
- `Prismify: Detect Code Style`
- `Prismify: Add Explanatory Comments`

---

## 📋 CLI Reference

```
Options:
  -p, --preview           Preview changes without writing
  -v, --verbose           Show detailed output
  -l, --language <lang>   Specify language: js, ts, python, java
  --provider <type>       AI provider: ollama, mock, auto

Refactoring:
  -r, --refactor          Enable semantic refactoring analysis

Explainability:
  -e, --explain           Add AI-generated explanatory comments
  --explain-level <level> Detail: beginner, pr-review, production

Styles:
  -s, --style <profile>   Profile: google, airbnb, minimal, python
  --detect-style          Auto-detect style from existing code
```

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

---

## 📄 License

MIT © [Pranav Dwivedi](https://github.com/pronzzz)
