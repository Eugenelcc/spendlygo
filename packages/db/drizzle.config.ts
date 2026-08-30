import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// The single .env lives at the repository root — see src/scripts/migrate.ts.
loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

/**
 * `drizzle-kit generate` diffs the schema against the committed migrations and
 * never opens a connection, so it works without DATABASE_URL. `studio` and
 * `push` do connect — hence the warning rather than a silent localhost fallback.
 */
const url = process.env.DATABASE_URL;
if (!url) {
  console.warn(
    '! DATABASE_URL is not set. `generate` works offline; `studio` and `push` will not.',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: { url: url ?? 'postgresql://localhost:5432/spendlygo' },
  strict: true,
  verbose: true,
});
