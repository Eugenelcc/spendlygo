// GUARDRAILS.md section 8: the Mini App's initial JS budget is 200 KB gzipped.
// A cold start on mid-range Android is the first impression; protect it in CI.
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BUDGET_BYTES = 200 * 1024;
const assetsDir = join(process.cwd(), 'apps/miniapp/dist/assets');

if (!existsSync(assetsDir)) {
  console.error(`No build output at ${assetsDir} — run \`pnpm build\` first.`);
  process.exit(1);
}

let total = 0;
const rows = [];
for (const file of readdirSync(assetsDir)) {
  if (!file.endsWith('.js')) continue;
  const gzipped = gzipSync(readFileSync(join(assetsDir, file))).byteLength;
  total += gzipped;
  rows.push([file, gzipped]);
}

for (const [file, size] of rows.sort((a, b) => b[1] - a[1])) {
  console.log(`  ${(size / 1024).toFixed(1).padStart(7)} KB  ${file}`);
}

const pct = ((total / BUDGET_BYTES) * 100).toFixed(0);
console.log(`\nTotal JS: ${(total / 1024).toFixed(1)} KB gzipped (${pct}% of 200 KB budget)`);

if (total > BUDGET_BYTES) {
  console.error(`\n✗ Bundle budget exceeded by ${((total - BUDGET_BYTES) / 1024).toFixed(1)} KB.`);
  process.exit(1);
}
console.log('✓ Within budget.');
