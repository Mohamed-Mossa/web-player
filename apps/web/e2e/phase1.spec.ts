import { expect, test } from '@playwright/test';
import { MOCK, activeLabel, addXtream, addXtreamAndSync, remote } from './helpers';

test.describe('sources', () => {
  test('Xtream login shows account info and syncs 50k items', async ({ page }) => {
    await addXtreamAndSync(page);
    const card = page.getByTestId('playlist-card');
    await expect(card.getByTestId('account-status')).toHaveText(/Active/);
    await expect(card.getByTestId('connections')).toHaveText('0 of 2 in use');
    await expect(card.getByTestId('expires')).toContainText('(5d)');
    await expect(card.getByTestId('sync-done')).toContainText('30000 movies · 8000 series · 12000 channels');
    // expiry warning on Home
    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('banners')).toContainText('expires in 5 days');
  });

  test('wrong password shows a clear error', async ({ page }) => {
    await addXtream(page, { pass: 'nope' });
    await expect(page.getByTestId('add-error')).toHaveText('Wrong username or password.');
  });

  test('M3U link with Xtream credentials is upgraded to Xtream', async ({ page }) => {
    await page.goto('/sources/add');
    await page.getByTestId('type-m3u').click();
    await page.getByTestId('f-url').fill(`${MOCK}/get.php?username=test&password=test&type=m3u_plus`);
    await page.getByTestId('connect').click();
    await expect(page.getByTestId('playlist-card')).toContainText('Xtream');
    await expect(page.getByTestId('account-status')).toBeVisible();
  });

  test('plain M3U playlist is parsed into live, movies and series', async ({ page }) => {
    await page.goto('/sources/add');
    await page.getByTestId('type-m3u').click();
    await page.getByTestId('f-url').fill(`${MOCK}/playlist.m3u`);
    await page.getByTestId('connect').click();
    await expect(page.getByTestId('sync-done')).toHaveText(/5000 movies · \d+ series · 2000 channels/, { timeout: 60_000 });
    await page.getByTestId('nav-series').click();
    await page.getByTestId('card').first().click();
    await expect(page.getByTestId('episode').first()).toBeVisible();
    expect(await page.getByTestId('episode').count()).toBeGreaterThanOrEqual(3);
  });
});

test.describe('catalog', () => {
  test.beforeEach(async ({ page }) => addXtreamAndSync(page));

  test('virtualized grid keeps the DOM small and filters work', async ({ page }) => {
    await page.getByTestId('nav-movies').click();
    await expect(page.getByTestId('result-count')).toHaveText('30000 titles');
    expect(await page.getByTestId('card').count()).toBeLessThan(80);
    await page.getByTestId('filters-toggle').click();
    await page.getByTestId('decade-2010').click();
    const n = Number((await page.getByTestId('result-count').textContent())!.split(' ')[0]);
    expect(n).toBeGreaterThan(1000);
    expect(n).toBeLessThan(30000);
    await page.getByTestId('sort-name').click();
    await page.getByRole('button', { name: /^English Movies$/ }).click();
    const m = Number((await page.getByTestId('result-count').textContent())!.split(' ')[0]);
    expect(m).toBeLessThan(n);
  });

  test('categories can be hidden, renamed and reordered', async ({ page }) => {
    await page.getByTestId('nav-movies').click();
    const cats = page.getByTestId('category');
    await expect(cats.nth(1)).toHaveText('Arabic Movies');
    await page.getByTestId('manage-categories').click();
    const rows = page.getByTestId('manage-row');
    await rows.nth(0).getByTestId('toggle-hidden').click(); // hide Arabic Movies
    await rows.nth(1).getByTestId('rename').click(); // English Movies
    await page.getByTestId('rename-input').fill('Hollywood');
    await page.getByTestId('rename-save').click();
    await rows.nth(2).getByTestId('move-up').click(); // Netflix above Hollywood
    await page.getByTestId('manage-categories').click();
    await expect(cats.nth(1)).toHaveText('Netflix');
    await expect(cats.nth(2)).toHaveText('Hollywood');
    await expect(page.getByTestId('category').filter({ hasText: 'Arabic Movies' })).toHaveCount(0);
    // hidden category items are gone from "All"
    const all = Number((await page.getByTestId('result-count').textContent())!.split(' ')[0]);
    expect(all).toBeLessThan(30000);
  });

  test('search tolerates typos and Arabic spelling variants', async ({ page }) => {
    await page.getByTestId('nav-search').click();
    await page.getByTestId('search-input').fill('intersteller');
    await expect(page.getByTestId('hit-movie').first()).toContainText('Interstellar');
    await page.getByTestId('search-input').fill('فيل ازرق');
    await expect(page.getByTestId('hit-movie').first()).toContainText('الفيل الأزرق');
    await page.getByTestId('search-input').fill('mbc 1');
    await expect(page.getByTestId('hit-live').first()).toContainText('MBC 1');
  });

  test('details show TMDB data, seasons and favorites land on Home', async ({ page }) => {
    await page.goto('/movie/' + (await firstPlaylistId(page)) + '/10000');
    await expect(page.getByTestId('details-title')).toHaveText('The Matrix');
    await expect(page.getByText('Actor 1')).toBeVisible();
    await page.getByTestId('favorite').click();
    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('row-favorites')).toContainText('The Matrix');
    await page.getByTestId('nav-series').click();
    await page.getByTestId('card').first().click();
    await expect(page.getByTestId('season-chip').first()).toBeVisible();
    await expect(page.getByTestId('episode')).toHaveCount(8);
  });

  test('remote control: D-pad moves through the grid, Back returns', async ({ page }) => {
    await page.getByTestId('nav-movies').click();
    await expect(page.getByTestId('card').first()).toBeVisible();
    await page.waitForTimeout(400);
    expect(await activeLabel(page)).toBe('The Matrix');
    await remote(page, 'ArrowDown', 10);
    expect(await page.getByTestId('poster-grid').evaluate((e) => e.scrollTop)).toBeGreaterThan(2000);
    await remote(page, 'Enter');
    await expect(page.getByTestId('details-title')).toBeVisible();
    await remote(page, 'Escape');
    await expect(page.getByTestId('poster-grid')).toBeVisible();
  });
});

test('profiles with PIN', async ({ page }) => {
  await page.goto('/profiles?manage=1');
  await page.getByTestId('add-profile').click();
  await page.getByTestId('profile-name').fill('Kids');
  await page.getByTestId('profile-pin').fill('1234');
  await page.getByTestId('profile-save').click();
  await page.getByTestId('manage-profiles').click();
  await page.getByTestId('profile').filter({ hasText: 'Kids' }).click();
  await expect(page.getByTestId('pin-dialog')).toBeVisible();
  await page.keyboard.type('9999');
  await expect(page.getByRole('alert')).toHaveText('Wrong PIN');
  await page.keyboard.type('1234');
  await expect(page.getByTestId('nav-profile')).toHaveAttribute('title', 'Kids');
});

test('Arabic switches the whole UI to RTL; version is shown', async ({ page }) => {
  await page.goto('/settings');
  await page.getByTestId('lang-ar').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'الإعدادات' })).toBeVisible();
  await expect(page.getByTestId('app-version')).toContainText('0.1.0');
  const rail = await page.getByTestId('nav-rail').boundingBox();
  expect(rail!.x).toBeGreaterThan(1000); // nav rail moved to the right edge
});

async function firstPlaylistId(page: import('@playwright/test').Page) {
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const req = indexedDB.open('iptv');
        req.onsuccess = () => {
          const tx = req.result.transaction('playlists');
          const all = tx.objectStore('playlists').getAll();
          all.onsuccess = () => resolve(all.result[0].id);
        };
      }),
  );
}
