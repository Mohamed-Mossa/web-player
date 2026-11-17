// Assembles the Samsung TV app: dist-tizen + config.xml + icon → dist-tizen-pkg/ and tizen-app.zip.
// The zip is unsigned; apps/tizen/install.ps1 (or install.sh) signs it with your Samsung
// certificate and installs it on the TV.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';

const web = new URL('..', import.meta.url).pathname;
const src = join(web, 'dist-tizen');
const out = join(web, 'dist-tizen-pkg');
const tizen = join(web, '../tizen');
if (!existsSync(join(src, 'index.html'))) throw new Error('Run `vite build --mode tizen` first');

const pkg = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'));
// Tizen wants x.y.z with numbers only
const version = String(pkg.version).replace(/[^0-9.]/g, '').split('.').concat('0', '0').slice(0, 3).join('.');

rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });
writeFileSync(join(out, 'config.xml'), readFileSync(join(tizen, 'config.xml'), 'utf8').replace('__VERSION__', version));
cpSync(join(tizen, 'icon.png'), join(out, 'icon.png'));

const files = {};
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else files[relative(out, p).split('\\').join('/')] = readFileSync(p);
  }
};
walk(out);
writeFileSync(join(web, 'tizen-app.zip'), zipSync(files, { level: 9 }));
console.log(`✓ Samsung app ${version}: ${Object.keys(files).length} files → apps/web/tizen-app.zip`);
