import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
    coverage: {
      include: ['packages/core/src/**'],
      thresholds: {
        // GUARDRAILS.md section 13: the domain core is the dangerous part.
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
