import { expect, type Page } from '@playwright/test';

export const MOCK = 'http://localhost:4010';

export async function addXtream(page: Page, opts: { user?: string; pass?: string; name?: string } = {}) {
  await page.goto('/sources/add');
  await page.getByTestId('f-name').fill(opts.name ?? 'Mock');
  await page.getByTestId('f-server').fill(MOCK);
  await page.getByTestId('f-username').fill(opts.user ?? 'test');
  await page.getByTestId('f-password').fill(opts.pass ?? 'test');
  await page.getByTestId('connect').click();
}

export async function addXtreamAndSync(page: Page) {
  await addXtream(page);
  await expect(page.getByTestId('sync-done')).toContainText('30000', { timeout: 90_000 });
}

/** Presses a key the way a remote does: one press, then a short pause (the nav throttles bursts). */
export async function remote(page: Page, key: string, times = 1) {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(140);
  }
}

export const activeLabel = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? '');
