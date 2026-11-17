import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MOCK } from './helpers';

/**
 * The Samsung package (TIZEN=1 vite build --mode mock --outDir dist-tizen-mock), opened from
 * file:// like the TV does, with Samsung's `tizen` and `webapis.avplay` objects stubbed.
 * --disable-web-security stands in for config.xml's <access origin="*">.
 */
const DIST = fileURLToPath(new URL('../dist-tizen-mock/index.html', import.meta.url));
const URL_ = `file://${DIST}`;

test.skip(!existsSync(DIST), 'build the Samsung package first: TIZEN=1 vite build --mode mock --outDir dist-tizen-mock');
test.use({
  baseURL: undefined,
  viewport: { width: 1920, height: 1080 },
  launchOptions: {
    args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-web-security'],
    executablePath: process.env.CHROME_PATH ?? (process.env.CI ? undefined : '/usr/bin/google-chrome'),
  },
});

declare global {
  interface Window {
    __av: { calls: string[]; listener: Record<string, (...a: unknown[]) => void> | null; state: string; time: number };
    __exited: boolean;
    __keys: string[];
  }
}

async function stubSamsung(page: Page) {
  await page.addInitScript(() => {
    window.__exited = false;
    window.__keys = [];
    const av = { calls: [] as string[], listener: null as Record<string, (...a: unknown[]) => void> | null, state: 'NONE', time: 0 };
    window.__av = av;
    let timer: ReturnType<typeof setInterval> | null = null;
    const log = (s: string) => av.calls.push(s);
    (window as unknown as { tizen: unknown }).tizen = {
      tvinputdevice: { registerKey: (k: string) => window.__keys.push(k) },
      application: { getCurrentApplication: () => ({ exit: () => (window.__exited = true), hide() {} }) },
    };
    (window as unknown as { webapis: unknown }).webapis = {
      avplay: {
        open: (u: string) => {
          log(`open ${u}`);
          av.state = 'IDLE';
        },
        close: () => {
          log('close');
          av.state = 'NONE';
          if (timer) clearInterval(timer);
        },
        stop: () => {
          av.state = 'IDLE';
          if (timer) clearInterval(timer);
        },
        setListener: (l: Record<string, (...a: unknown[]) => void>) => (av.listener = l),
        setDisplayRect: () => {},
        setDisplayMethod: () => {},
        setBufferingParam: () => {},
        setStreamingProperty: () => {},
        prepareAsync: (ok: () => void) => {
          log('prepare');
          setTimeout(() => {
            av.state = 'READY';
            ok();
          }, 50);
        },
        play: () => {
          log('play');
          av.state = 'PLAYING';
          if (timer) clearInterval(timer);
          timer = setInterval(() => {
            av.time += 250;
            av.listener?.oncurrentplaytime?.(av.time);
          }, 250);
        },
        pause: () => {
          log('pause');
          av.state = 'PAUSED';
          if (timer) clearInterval(timer);
        },
        seekTo: (ms: number, ok?: () => void) => {
          log(`seek ${ms}`);
          av.time = ms;
          ok?.();
        },
        getState: () => av.state,
        getCurrentTime: () => av.time,
        getDuration: () => 600_000,
        getTotalTrackInfo: () => [
          { index: 0, type: 'VIDEO', extra_info: '{}' },
          { index: 1, type: 'AUDIO', extra_info: '{"language":"eng","fourCC":"AAC","channels":2}' },
          { index: 2, type: 'AUDIO', extra_info: '{"language":"ara","fourCC":"AC3","channels":6}' },
          { index: 3, type: 'TEXT', extra_info: '{"track_lang":"ara"}' },
        ],
        getCurrentStreamInfo: () => [{ index: 1, type: 'AUDIO', extra_info: '{}' }],
        setSelectTrack: (t: string, i: number) => log(`track ${t} ${i}`),
        setSilentSubtitle: (b: boolean) => log(`silent ${b}`),
        setSpeed: () => {},
        suspend: () => {},
        restore: () => {},
      },
    };
  });
}

/** A Samsung remote key: Tizen key code, XF86 name. */
const tvKey = (page: Page, keyCode: number, key = 'Unidentified') =>
  page.evaluate(([c, k]) => {
    const e = new KeyboardEvent('keydown', { key: k as string, bubbles: true, cancelable: true });
    Object.defineProperty(e, 'keyCode', { get: () => c });
    (document.activeElement ?? document.body).dispatchEvent(e);
  }, [keyCode, key] as const);

test('Samsung package: loads from file://, syncs with workers, plays through AVPlay, remote keys work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await stubSamsung(page);
  await page.goto(URL_);
  await expect(page.locator('html')).toHaveAttribute('data-layout', 'tv');
  expect(await page.evaluate(() => window.__keys)).toContain('ChannelUp');

  // add a provider (hash routes) and let the inline catalog worker sync it into IndexedDB
  await page.goto(`${URL_}#/sources/add`);
  await page.getByTestId('f-name').fill('Mock');
  await page.getByTestId('f-server').fill(MOCK);
  await page.getByTestId('f-username').fill('test');
  await page.getByTestId('f-password').fill('test');
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('sync-done')).toContainText('30000', { timeout: 90_000 });

  // search worker
  await page.goto(`${URL_}#/search?q=matrix`);
  await expect(page.getByText('The Matrix').first()).toBeVisible({ timeout: 30_000 });

  const pid = await page.evaluate(
    () =>
      new Promise<string>((r) => {
        const q = indexedDB.open('iptv');
        q.onsuccess = () => {
          const g = q.result.transaction('playlists').objectStore('playlists').getAll();
          g.onsuccess = () => r(g.result[0].id);
        };
      }),
  );

  // movie → AVPlay, not a <video>
  await page.goto(`${URL_}#/movie/${pid}/10000`);
  await page.getByTestId('play').click();
  await expect(page.getByTestId('player-title')).toHaveText('The Matrix');
  await expect.poll(() => page.evaluate(() => window.__av.calls.filter((c) => /^(open|prepare|play)/.test(c)).length)).toBeGreaterThanOrEqual(3);
  expect(await page.evaluate(() => window.__av.calls.find((c) => c.startsWith('open')))).toMatch(/^open http:\/\/localhost:4010\/movie\/test\/test\/10000\./);
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.locator('object#av-player')).toHaveCount(1);
  await expect(page.locator('html')).toHaveClass(/native-video/);

  // embedded tracks from AVPlay
  await page.mouse.move(400, 300);
  await page.getByTestId('player-tracks').click();
  await expect(page.getByTestId('audio-option')).toHaveCount(2);
  await page.getByTestId('audio-option').nth(1).click();
  await expect.poll(() => page.evaluate(() => window.__av.calls.includes('track AUDIO 2'))).toBe(true);
  await page.keyboard.press('Escape');

  // remote: PLAY/PAUSE (10252), then Return (10009) leaves the player
  await page.waitForTimeout(300);
  await tvKey(page, 10252, 'XF86PlayBack');
  await expect.poll(() => page.evaluate(() => window.__av.calls.includes('pause'))).toBe(true);
  await tvKey(page, 10009, 'XF86Back');
  await tvKey(page, 10009, 'XF86Back');
  await expect(page.getByTestId('player')).toHaveCount(0);
  await expect(page.locator('object#av-player')).toHaveCount(0);

  // Return on the home screen exits the app
  await page.goto(`${URL_}#/`);
  await expect(page.getByTestId('nav-home')).toBeVisible();
  await tvKey(page, 10009, 'XF86Back');
  await expect.poll(() => page.evaluate(() => window.__exited)).toBe(true);

  expect(errors).toEqual([]);
});
