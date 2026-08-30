import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  // Workspace packages ship raw TypeScript, so bundle them in rather than
  // adding a build step to every package. Everything else stays external:
  // bundling a CJS dependency into this ESM output breaks its `require` calls
  // at runtime, which is a failure that only shows up in production.
  noExternal: [/^@spendlygo\//],
  skipNodeModulesBundle: true,
  clean: true,
  sourcemap: true,
  minify: false,
  splitting: false,
  dts: false,
});
