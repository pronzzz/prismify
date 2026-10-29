import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        testTimeout: 30000,
        // The Python tests shell out to python3; keep tool detection deterministic.
        env: { PRISMIFY_PYTHON_FORMATTER: 'builtin', OLLAMA_HOST: 'http://127.0.0.1:9' },
    },
});
