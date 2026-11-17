import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'build/**/*.test.ts'], environment: 'node' },
  define: { __APP_VERSION__: '"test"', __GIT_SHA__: '"test"', __BUILD_TIME__: '"2026-01-01"', __TIZEN__: 'false' },
  resolve: {
    alias: {
      'virtual-worker-factory': here('./src/workers/factory.web.ts'),
      'virtual-worker-polyfills': here('./src/workers/polyfills.none.ts'),
    },
  },
});
