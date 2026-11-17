// Static check of the Samsung build (dist-tizen) against Chromium 69 (Tizen 5.5, 2020 TVs):
// every script (and every worker inlined into them) must parse as ES2019, and the stylesheet
// must not contain features Chromium 69 drops. Run after `pnpm build:tizen`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';

const dir = process.argv[2] ?? 'dist-tizen';
const assets = join(dir, 'assets');
let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(`✗ ${msg}`);
};

function checkJs(name, code, depth = 0) {
  let ast;
  try {
    ast = parse(code, { ecmaVersion: 2019, sourceType: 'script' });
  } catch (e) {
    const at = e.pos ?? 0;
    return fail(`${name}: ${e.message} near …${code.slice(Math.max(0, at - 60), at + 40).replace(/\s+/g, ' ')}…`);
  }
  // workers are bundled as long string literals
  if (depth === 0) {
    let n = 0;
    const look = (s) => {
      if (s.length > 20_000 && /self\.onmessage|importScripts|postMessage/.test(s)) {
        if (/require\("@oxc-project/.test(s)) fail(`${name}: worker needs oxc runtime helpers`);
        checkJs(`${name} › worker ${++n}`, s, 1);
      }
    };
    simple(ast, {
      Literal: (node) => typeof node.value === 'string' && look(node.value),
      TemplateLiteral: (node) => node.quasis.forEach((q) => look(q.value.cooked ?? '')),
    });
  }
}

for (const f of readdirSync(assets).filter((f) => f.endsWith('.js'))) checkJs(f, readFileSync(join(assets, f), 'utf8'));

const CSS_RULES = [
  [/@layer\b/, 'cascade layers'],
  [/:where\(|:is\(|:dir\(|:has\(/, ':where/:is/:dir/:has selectors'],
  [/(?:margin|padding|inset|border)-(?:inline|block)(?:-start|-end)?\s*:/, 'logical properties'],
  [/(?:^|[;{\s])(?:translate|rotate|scale)\s*:/, 'individual transforms'],
  [/(?:^|[;{\s])inset\s*:/, 'inset shorthand'],
  [/\d[dsl]v[hw]\b/, 'dynamic viewport units'],
  [/@property\b/, '@property'],
  [/\(\s*(?:width|height)\s*[<>]=?/, 'media range syntax'],
  [/:lang\([^)]*,/, ':lang() lists'],
];
for (const f of readdirSync(assets).filter((f) => f.endsWith('.css'))) {
  const css = readFileSync(join(assets, f), 'utf8').replace(/@supports \(color: ?color-mix[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  for (const [re, what] of CSS_RULES) {
    const m = re.exec(css);
    if (m) fail(`${f}: ${what} — …${css.slice(Math.max(0, m.index - 60), m.index + 40)}…`);
  }
}

const html = readFileSync(join(dir, 'index.html'), 'utf8');
if (/type="module"|\scrossorigin[\s>=]|\snomodule[\s>=]/.test(html)) fail('index.html still has module/crossorigin/nomodule scripts');
if (!html.includes('$WEBAPIS/webapis/webapis.js')) fail('index.html does not load webapis.js');

if (failed) process.exit(1);
console.log('✓ dist-tizen looks compatible with Chromium 69 (Samsung TVs 2020+)');
