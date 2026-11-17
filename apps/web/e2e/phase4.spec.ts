import { expect, test, type Page } from '@playwright/test';
import { addXtreamAndSync, remote } from './helpers';

test.use({ launchOptions: { args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], executablePath: process.env.CHROME_PATH ?? (process.env.CI ? undefined : '/usr/bin/google-chrome') } });

async function setup(page: Page) {
  await addXtreamAndSync(page);
  // wait for the guide import to finish
  await expect.poll(async () => page.evaluate(() => new Promise<number>((r) => {
    const q = indexedDB.open('iptv');
    q.onsuccess = () => {
      const g = q.result.transaction('playlists').objectStore('playlists').getAll();
      g.onsuccess = () => r(g.result[0]?.epgCount ?? 0);
    };
  })), { timeout: 60_000 }).toBeGreaterThan(1000);
}
const waitPlaying = (page: Page) => page.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0.5, null, { timeout: 40_000 });

test.beforeEach(async ({ page }) => setup(page));

test('channel list shows now/next; zapping with up/down, numbers and last channel', async ({ page }) => {
  await page.getByTestId('nav-live').click();
  await expect(page.getByTestId('now-title').first()).toBeVisible();
  await page.getByTestId('channel-row').first().click();
  await waitPlaying(page);
  await expect(page.getByTestId('live-name')).toHaveText('MBC 1 HD');
  await expect(page.getByTestId('live-now')).not.toBeEmpty();
  await expect(page.getByTestId('live-osd')).toHaveAttribute('data-visible', 'false', { timeout: 10_000 });
  await remote(page, 'ArrowDown');
  await expect(page.getByTestId('live-num')).toHaveText('2');
  await remote(page, 'Escape'); // hide banner
  await page.keyboard.type('12');
  await expect(page.getByTestId('digits')).toHaveText('12');
  await expect(page.getByTestId('live-num')).toHaveText('12', { timeout: 5000 });
  await remote(page, 'Escape');
  await page.keyboard.press('l'); // last channel
  await expect(page.getByTestId('live-num')).toHaveText('2');
});

test('channel list overlay on top of the player', async ({ page }) => {
  await page.getByTestId('nav-live').click();
  await page.getByTestId('channel-row').first().click();
  await waitPlaying(page);
  await expect(page.getByTestId('live-osd')).toHaveAttribute('data-visible', 'false', { timeout: 10_000 });
  await remote(page, 'Enter');
  await expect(page.getByTestId('channel-overlay')).toBeVisible();
  await remote(page, 'ArrowDown', 3);
  await remote(page, 'Enter');
  await expect(page.getByTestId('live-num')).toHaveText('4');
});

test('favorite channel groups', async ({ page }) => {
  await page.getByTestId('nav-live').click();
  await page.getByTestId('new-group').click();
  await page.getByTestId('group-name').fill('Sports');
  await page.getByTestId('group-save').click();
  await expect(page.getByTestId('group-custom')).toHaveText('Sports (0)');
  await page.getByRole('button', { name: /^All$/ }).click();
  await page.getByTestId('channel-row').nth(2).click();
  await waitPlaying(page);
  await page.mouse.move(300, 300);
  await page.getByTestId('live-add-group').click();
  await page.getByTestId('group-toggle').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('live-fav').click();
  await page.goBack();
  await expect(page.getByTestId('group-custom')).toHaveText('Sports (1)');
  await page.getByTestId('group-fav').click();
  await expect(page.getByTestId('channel-row')).toHaveCount(1);
});

test('guide: reminders and catch-up', async ({ page }) => {
  await page.goto('/live?view=guide');
  await page.getByTestId('epg-future').first().click();
  await expect(page.getByTestId('reminder-on').first()).toBeVisible();
  await page.getByTestId('epg-catchup').first().click();
  await expect(page.getByTestId('live-player')).toContainText('CATCH-UP');
  await waitPlaying(page);
});

test('reminder fires when the programme starts', async ({ page }) => {
  await page.evaluate(() => new Promise<void>((r) => {
    const q = indexedDB.open('iptv');
    q.onsuccess = () => {
      const db = q.result;
      const pl = db.transaction('playlists').objectStore('playlists').getAll();
      pl.onsuccess = () => {
        const tx = db.transaction('reminders', 'readwrite');
        tx.objectStore('reminders').put({ id: 'x', profileId: 'default', playlistId: pl.result[0].id, channelId: '1000', channelName: 'MBC 1 HD', title: 'Big Match', start: Date.now() + 30_000, stop: Date.now() + 3600_000 });
        tx.oncomplete = () => r();
      };
    };
  }));
  await page.goto('/');
  await expect(page.getByTestId('reminder-toasts')).toContainText('Big Match');
  await page.getByTestId('reminder-toasts').getByRole('button', { name: 'Watch' }).click();
  await expect(page.getByTestId('live-name')).toHaveText('MBC 1 HD');
});

test('multi-view plays several channels and warns above the connection limit', async ({ page }) => {
  await page.goto('/multiview');
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('mv-add').first().click();
    await page.getByTestId('mv-option').nth(i).click();
  }
  await expect(page.getByTestId('mv-tile')).toHaveCount(3);
  await page.waitForFunction(() => [...document.querySelectorAll('video')].filter((v) => v.currentTime > 0.5).length >= 3, null, { timeout: 40_000 });
  await expect(page.getByTestId('mv-warning')).toContainText('2 streams');
  expect(await page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.muted).length)).toBe(1);
});
