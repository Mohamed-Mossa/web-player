import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
  define: { __APP_VERSION__: '"test"', __GIT_SHA__: '"test"', __BUILD_TIME__: '"2026-01-01"' },
});
