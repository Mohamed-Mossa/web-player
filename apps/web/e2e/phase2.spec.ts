import { expect, test, type Page } from '@playwright/test';
import { MOCK, addXtreamAndSync, remote } from './helpers';

test.use({ launchOptions: { args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], executablePath: process.env.CHROME_PATH ?? (process.env.CI ? undefined : '/usr/bin/google-chrome') } });

let pid = '';
async function setup(page: Page) {
  await addXtreamAndSync(page);
  pid = await page.evaluate(
    () => new Promise<string>((r) => {
      const q = indexedDB.open('iptv');
      q.onsuccess = () => {
        const g = q.result.transaction('playlists').objectStore('playlists').getAll();
        g.onsuccess = () => r(g.result[0].id);
      };
    }),
  );
}
const time = (page: Page) => page.evaluate(() => document.querySelector('video')!.currentTime);
const waitTime = (page: Page, t: number) => page.waitForFunction((x) => (document.querySelector('video')?.currentTime ?? 0) > x, t, { timeout: 40_000 });

test.beforeEach(async ({ page }) => setup(page));

test('movie plays; remote seeks, controls hide, Back exits', async ({ page }) => {
  await page.goto(`/movie/${pid}/10000`);
  await page.getByTestId('play').click();
  await expect(page.getByTestId('player-title')).toHaveText('The Matrix');
  await waitTime(page, 1);
  await expect(page.getByTestId('controls')).toHaveAttribute('data-visible', 'false', { timeout: 8000 });
  const before = await time(page);
  await remote(page, 'ArrowRight');
  expect(await time(page)).toBeGreaterThan(before + 8);
  await expect(page.getByTestId('controls')).toHaveAttribute('data-visible', 'true');
  await expect(page.getByTestId('controls')).toHaveAttribute('data-visible', 'false', { timeout: 8000 });
  await remote(page, 'Escape');
  await expect(page.getByTestId('details-title')).toBeVisible();
  // progress saved → Play button offers the resume position, Home shows Continue watching
  await expect(page.getByTestId('play')).toContainText(':');
  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId('row-continue')).toContainText('The Matrix');
});

test('resume prompt continues from the saved position', async ({ page }) => {
  await page.goto(`/play/movie/${pid}/10000`);
  await waitTime(page, 1);
  await page.evaluate(() => (document.querySelector('video')!.currentTime = 20));
  await waitTime(page, 21);
  await remote(page, 'Escape'); // hide controls if shown
  await remote(page, 'Escape'); // exit the player
  await expect(page.getByTestId('player')).toHaveCount(0);
  // the position is written to IndexedDB on exit; wait for it before reloading the page
  await expect.poll(() => page.evaluate(() => new Promise<number>((r) => {
    const q = indexedDB.open('iptv');
    q.onsuccess = () => {
      const g = q.result.transaction('progress').objectStore('progress').getAll();
      g.onsuccess = () => r(Math.max(0, ...g.result.map((x: { positionSec: number }) => x.positionSec)));
    };
  }))).toBeGreaterThan(19);
  await page.goto(`/play/movie/${pid}/10000`);
  await expect(page.getByTestId('resume-dialog')).toBeVisible();
  await page.keyboard.press('Enter'); // "Resume" is focused
  await waitTime(page, 19);
});

test('HLS: audio tracks, embedded subtitles, speed', async ({ page }) => {
  await page.goto(`/play/movie/${pid}/10002`);
  await waitTime(page, 0.5);
  await page.mouse.move(400, 300);
  await page.getByTestId('player-tracks').click();
  await expect(page.getByTestId('audio-option')).toHaveText(['English', 'Arabic']);
  await page.getByTestId('audio-option').nth(1).click();
  await expect(page.getByTestId('audio-option').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('text-option').first().click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('subtitles')).toContainText('Subtitle line', { timeout: 15_000 });
  await page.mouse.move(420, 300);
  await page.getByTestId('player-speed').click();
  await page.getByTestId('speed-option').filter({ hasText: '1.5×' }).click();
  expect(await page.evaluate(() => document.querySelector('video')!.playbackRate)).toBe(1.5);
});

test('external SRT file with timing offset, and OpenSubtitles search', async ({ page }) => {
  await page.goto(`/play/movie/${pid}/10000`);
  await waitTime(page, 0.5);
  await page.mouse.move(400, 300);
  await page.getByTestId('player-tracks').click();
  const srt = Array.from({ length: 30 }, (_, i) => `${i + 1}\n00:00:${String(i).padStart(2, '0')},000 --> 00:00:${String(i).padStart(2, '0')},900\nملف ${i + 1}\n`).join('\n');
  await page.getByTestId('subs-file').setInputFiles({ name: 'ar.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt) });
  await page.getByTestId('offset-plus').click();
  await expect(page.getByTestId('offset-value')).toHaveText('+0.5 s');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('subtitles')).toContainText('ملف');

  await page.mouse.move(420, 300);
  await page.getByTestId('player-tracks').click();
  await page.getByTestId('subs-online').click();
  await page.getByTestId('os-hit').first().click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('subtitles')).toContainText('سطر ترجمة', { timeout: 10_000 });
});

test('series: next episode countdown and watched marks', async ({ page }) => {
  await page.goto(`/series/${pid}/50000`);
  await expect(page.getByTestId('episode').first()).toBeVisible();
  await page.getByTestId('episode').first().click();
  await waitTime(page, 0.5);
  await page.evaluate(() => {
    const v = document.querySelector('video')!;
    v.currentTime = v.duration - 0.5;
  });
  await expect(page.getByTestId('next-up')).toBeVisible({ timeout: 10_000 });
  const url = page.url();
  await page.keyboard.press('Enter'); // Play now
  await expect.poll(() => page.url()).not.toBe(url);
  expect(page.url()).toContain('5000012'); // S1E2 id in the mock
  await page.goto(`/series/${pid}/50000`);
  await expect(page.getByTestId('play')).toContainText('S1 E2');
  await expect(page.getByTestId('episode').first().locator('svg')).toBeVisible(); // ✓ on episode 1
});

test('live stream reconnects after drops', async ({ page }) => {
  await page.goto(`/play/live/${pid}/1000`);
  await waitTime(page, 1);
  await fetch(`${MOCK}/__fail?n=6`);
  const t0 = await time(page);
  await page.waitForFunction((x) => document.querySelector('video')!.currentTime > x + 6, t0, { timeout: 60_000 });
  await expect(page.getByTestId('player-error')).toHaveCount(0);
});

test('clear error message when the server refuses the stream', async ({ page }) => {
  await page.goto(`/play/movie/${pid}/10003`);
  await expect(page.getByTestId('player-error')).toContainText('refused', { timeout: 30_000 });
});

test('sleep timer shows its countdown', async ({ page }) => {
  await page.goto(`/play/movie/${pid}/10000`);
  await waitTime(page, 0.5);
  await page.mouse.move(400, 300);
  await page.getByTestId('player-sleep').click();
  await page.getByTestId('sleep-option').filter({ hasText: '15' }).click();
  await page.mouse.move(410, 300);
  await expect(page.getByText(/Stops in 15 min/)).toBeVisible();
});
