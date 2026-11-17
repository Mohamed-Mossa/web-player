// Packs the web build for over-the-air updates of the Android app: dist/ota/bundle-<sha>.zip + version.json
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';
import { zipSync } from 'fflate';

const dist = new URL('../dist/', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
let sha = process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7);
if (!sha) {
  try { sha = execSync('git rev-parse --short HEAD').toString().trim(); } catch { sha = 'dev'; }
}
const nativeApi = Number(readFileSync(new URL('../src/env.ts', import.meta.url), 'utf8').match(/NATIVE_API = (\d+)/)?.[1] ?? 1);

const files = {};
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(dist, p);
    if (rel.startsWith('ota') || rel.endsWith('.map')) continue;
    if (statSync(p).isDirectory()) walk(p);
    else files[rel] = readFileSync(p);
  }
})(dist);

mkdirSync(join(dist, 'ota'), { recursive: true });
const zipName = `bundle-${sha}.zip`;
writeFileSync(join(dist, 'ota', zipName), zipSync(files, { level: 9 }));
const version = `${pkg.version}-${sha}`;
writeFileSync(join(dist, 'ota', 'version.json'), JSON.stringify({ version, sha, url: `/ota/${zipName}`, nativeApi }, null, 2));
console.log(`[ota] ${zipName} (${Object.keys(files).length} files) version ${version}`);
