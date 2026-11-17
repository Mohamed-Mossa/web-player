import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { transformWithOxc, type Plugin } from 'vite';
// @ts-expect-error plain ESM build script
import { lowerCss } from './lower-css.mjs';

/**
 * Finishes the Samsung (Tizen) build:
 * - index.html runs the legacy (SystemJS) bundle as plain scripts: module scripts and
 *   `crossorigin` both fail on file://, which is where packaged TV apps live.
 * - loads Samsung's webapis.js (AVPlay) before the app.
 * - lowers the stylesheet to Chromium 69 (see lower-css.mjs).
 * - deletes the modern bundle, which the TV never loads.
 */
export function tizen(): Plugin {
  let outDir = 'dist-tizen';
  return {
    name: 'iptv:tizen',
    apply: 'build',
    enforce: 'post',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        let out = html
          .replace(/<script type="module"[^>]*>[\s\S]*?<\/script>\s*/g, '')
          .replace(/<link rel="modulepreload"[^>]*>\s*/g, '')
          .replace(/<script nomodule>[\s\S]*?<\/script>\s*/g, '')
          .replace(/ nomodule/g, '')
          .replace(/ crossorigin/g, '');
        out = out.replace('</head>', '    <script src="$WEBAPIS/webapis/webapis.js"></script>\n  </head>');
        // SystemJS marks some chunk scripts crossorigin; under file:// that blocks them.
        out = out.replace(
          /(<script id="vite-legacy-polyfill"[^>]*><\/script>)/,
          `$1\n    <script>(function(){var P=System.constructor.prototype,c=P.createScript;P.createScript=function(u){var s=c.call(this,u);s.removeAttribute('crossorigin');return s;};})();</script>`,
        );
        return out;
      },
    },
    async generateBundle(_o, bundle) {
      for (const f of Object.values(bundle)) {
        if (f.type === 'asset' && f.fileName.endsWith('.css')) {
          f.source = await lowerCss(String(f.source), { from: f.fileName });
        }
        // The legacy entry also injects the original (unlowered) stylesheet; the HTML links the lowered one.
        if (f.type === 'chunk' && f.fileName.includes('-legacy')) {
          const start = f.code.indexOf('`/*! tailwindcss');
          if (start >= 0) {
            let end = start + 1;
            while (end < f.code.length && !(f.code[end] === '`' && f.code[end - 1] !== '\\')) end++;
            f.code = f.code.slice(0, start) + '``' + f.code.slice(end + 1);
          }
        }
      }
    },
    closeBundle() {
      const assets = join(outDir, 'assets');
      let files: string[];
      try {
        files = readdirSync(assets);
      } catch {
        return;
      }
      const js = files.filter((f) => f.endsWith('.js'));
      const keep = new Set<string>();
      const sources = [readFileSync(join(outDir, 'index.html'), 'utf8')];
      // follow references from the HTML and every legacy chunk
      let grew = true;
      while (grew) {
        grew = false;
        const text = sources.join('\n');
        for (const f of js) {
          if (!keep.has(f) && text.includes(f)) {
            keep.add(f);
            sources.push(readFileSync(join(assets, f), 'utf8'));
            grew = true;
          }
        }
      }
      for (const f of js) if (!keep.has(f)) rmSync(join(assets, f));
      // vite-plugin-pwa is off; Cloudflare's _headers file has no meaning inside a TV package
      rmSync(join(outDir, '_headers'), { force: true });
    },
  };
}

/**
 * Worker bundles skip plugin-legacy, so their syntax (?. ?? class fields…) is lowered here —
 * after minification, which would otherwise turn it back into modern syntax.
 */
export function tizenWorker(): Plugin {
  return {
    name: 'iptv:tizen-worker',
    async generateBundle(_o, bundle) {
      for (const f of Object.values(bundle)) {
        if (f.type !== 'chunk') continue;
        const r = await transformWithOxc(f.code, f.fileName, { target: 'chrome69' });
        f.code = r.code;
      }
    },
  };
}
