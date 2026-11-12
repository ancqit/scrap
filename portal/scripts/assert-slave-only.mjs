import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../src');
let failed = false;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!/\.(ts|html|css)$/.test(entry) || entry.endsWith('.spec.ts')) continue;
    if (readFileSync(path, 'utf8').includes('1001')) {
      console.error(`${path} contains the admin portal number`);
      failed = true;
    }
  }
}

walk(root);
if (failed) process.exit(1);
