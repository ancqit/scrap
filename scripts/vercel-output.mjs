import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.vercel/output');
const funcDir = path.join(output, 'functions/api/[...path].func');
const staticDir = path.join(root, 'portal/dist/portal/browser');
const esbuild = path.join(root, 'worker/node_modules/.bin/esbuild');

await rm(output, { recursive: true, force: true });
await mkdir(funcDir, { recursive: true });

const bundled = spawnSync(
  esbuild,
  [
    path.join(root, 'api/[...path].ts'),
    '--bundle',
    '--format=esm',
    '--platform=browser',
    '--target=es2022',
    `--outfile=${path.join(funcDir, 'index.js')}`,
  ],
  { stdio: 'inherit' },
);
if (bundled.status !== 0) process.exit(bundled.status ?? 1);

await writeFile(
  path.join(funcDir, '.vc-config.json'),
  JSON.stringify({ runtime: 'edge', entrypoint: 'index.js' }, null, 2),
);
await writeFile(path.join(funcDir, 'package.json'), JSON.stringify({ type: 'module' }));
await cp(staticDir, path.join(output, 'static'), { recursive: true });
await writeFile(
  path.join(output, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { handle: 'filesystem' },
        { src: '/((?!api/).*)', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
