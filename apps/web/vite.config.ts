import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import legacy from '@vitejs/plugin-legacy';
import { tizen as tizenBuild, tizenWorker } from './build/vite-plugin-tizen';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import pkg from './package.json' with { type: 'json' };

function gitSha(): string {
  if (process.env.CF_PAGES_COMMIT_SHA) return process.env.CF_PAGES_COMMIT_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ mode }) => {
  /** Samsung TV build (Tizen 5.5+ = Chromium 69): legacy JS, classic workers, no service worker, file:// paths. */
  const tizen = mode === 'tizen' || process.env.TIZEN === '1';
  return {
  base: tizen ? './' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_SHA__: JSON.stringify(gitSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __TIZEN__: JSON.stringify(tizen),
  },
  resolve: {
    alias: {
      // Workers are not run through plugin-legacy, so the Samsung build gives them core-js directly.
      ...(tizen ? { 'virtual:pwa-register': here('./src/lib/pwa.stub.ts') } : {}),
      'virtual-worker-factory': tizen ? here('./src/workers/factory.tizen.ts') : here('./src/workers/factory.web.ts'),
      'virtual-worker-polyfills': tizen ? here('./src/workers/polyfills.tizen.ts') : here('./src/workers/polyfills.none.ts'),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    tizen &&
      legacy({
        targets: ['chrome >= 69'],
      }),
    tizen && tizenBuild(),
    !tizen && VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'IPTV Player',
        short_name: 'IPTV',
        theme_color: '#0b0d12',
        background_color: '#0b0d12',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
  worker: { format: tizen ? 'iife' : 'es', plugins: () => (tizen ? [tizenWorker()] : []) },
  server: { port: 5173, host: true },
  // Pre-bundle deps that are only reached from workers or lazy imports, so the dev server does not
  // discover them mid-session and reload the page.
  optimizeDeps: { include: ['fflate', '@noble/ciphers/aes.js', '@noble/hashes/pbkdf2.js', '@noble/hashes/sha2.js'] },
  build: tizen
    ? { target: 'chrome69', outDir: 'dist-tizen', sourcemap: false, cssMinify: false, assetsInlineLimit: 0 }
    : { target: 'es2022', sourcemap: true },
  };
});
