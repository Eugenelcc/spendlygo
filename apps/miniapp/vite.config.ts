import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    // GUARDRAILS.md section 8: the initial JS budget is 200 KB gzipped, checked
    // in CI by scripts/check-bundle-size.mjs.
    chunkSizeWarningLimit: 300,
    sourcemap: false,
  },
  server: {
    port: 5173,
    host: true,
  },
});
