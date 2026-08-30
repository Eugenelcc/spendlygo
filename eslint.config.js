// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/build/**', '**/coverage/**', 'packages/db/migrations/**'],
  },
  js.configs.recommended,
  {
    // Node scripts run outside the TypeScript projects and need Node globals.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },
  {
    // GUARDRAILS.md section 5: nothing reads process.env directly except the
    // typed, validated config module.
    files: ['apps/server/src/**/*.ts'],
    ignores: [
      'apps/server/src/config.ts',
      'apps/server/src/scripts/**',
      // Tests read TEST_DATABASE_URL to decide whether to run at all.
      'apps/server/src/**/*.test.ts',
    ],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Import from ./config instead — see GUARDRAILS.md section 5.',
        },
      ],
    },
  },
);
