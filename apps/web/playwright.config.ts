import { defineConfig } from '@playwright/test';

const chrome = process.env.CHROME_PATH ?? (process.env.CI ? undefined : '/usr/bin/google-chrome');

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1440, height: 900 },
    launchOptions: chrome ? { executablePath: chrome, args: ['--no-sandbox'] } : {},
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node ../../tools/mock-server/server.mjs --port 4010',
      url: 'http://localhost:4010/health',
      reuseExistingServer: true,
    },
    {
      command: 'npx vite --mode mock --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: true,
    },
  ],
});
