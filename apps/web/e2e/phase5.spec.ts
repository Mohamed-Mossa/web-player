import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addXtreamAndSync } from './helpers';

test('encrypted backup: export on one device, restore on another', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await addXtreamAndSync(a);
  await a.goto('/series/' + (await a.evaluate(() => new Promise<string>((r) => {
    const q = indexedDB.open('iptv');
    q.onsuccess = () => {
      const g = q.result.transaction('playlists').objectStore('playlists').getAll();
      g.onsuccess = () => r(g.result[0].id);
    };
  }))) + '/50000');
  await a.getByTestId('favorite').click();
  await expect(a.getByTestId('favorite')).toContainText('Remove favorite');
  await a.goto('/settings');
  await a.getByTestId('lang-ar').click();
  await a.getByTestId('backup-export').click();
  await a.getByTestId('backup-pass').fill('secret-123');
  const dl = a.waitForEvent('download');
  await a.getByTestId('backup-go').click();
  const file = await (await dl).path();
  const text = readFileSync(file, 'utf8');
  expect(text).not.toContain('"test"'); // credentials are not readable in the file
  expect(JSON.parse(text).format).toBe('iptv-backup');

  const b = await (await browser.newContext()).newPage();
  await b.goto('/settings');
  await b.getByTestId('backup-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await b.getByTestId('backup-pass').fill('wrong-pass');
  await b.getByTestId('backup-go').click();
  await expect(b.getByTestId('backup-msg')).toHaveText('Wrong passphrase.');
  await b.getByTestId('backup-pass').fill('secret-123');
  await b.getByTestId('backup-go').click();
  await expect(b.locator('html')).toHaveAttribute('dir', 'rtl'); // settings restored
  await b.goto('/sources');
  await expect(b.getByTestId('sync-done')).toContainText('30000', { timeout: 90_000 }); // logins restored → catalog downloads
  await b.goto('/');
  await expect(b.getByTestId('row-favorites')).toBeVisible();
});

test('settings show the app version and build commit', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByTestId('app-version')).toContainText(/0\.1\.0 \(\w+\)/);
});
