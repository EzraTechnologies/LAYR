import { expect, test } from '@playwright/test';
import { defaultFiles, MockMoonraker, MOONRAKER } from './mockMoonraker';
import { expectCleanLayout, VIEWPORTS } from './helpers';
import { partThumbnail } from './png';

declare global {
  interface Window { thumbnailUrls: Set<string>; revokedThumbnails: string[]; unsafeRevocations: string[]; }
}

for (const vp of VIEWPORTS) {
  test.describe(`authenticated thumbnail cache ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('eviction and refresh preserve displayed URLs; unmount releases owners', async ({ page }) => {
      await page.addInitScript(() => {
        window.thumbnailUrls = new Set();
        window.revokedThumbnails = [];
        window.unsafeRevocations = [];
        const create = URL.createObjectURL.bind(URL);
        const revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = blob => { const url = create(blob); window.thumbnailUrls.add(url); return url; };
        URL.revokeObjectURL = url => {
          if ([...document.querySelectorAll('img')].some(img => img.src === url)) window.unsafeRevocations.push(url);
          window.thumbnailUrls.delete(url); window.revokedThumbnails.push(url); revoke(url); };
      });
      const template = defaultFiles()[0]!;
      const mock = new MockMoonraker({ scenario: 'ready', files: Array.from({ length: 40 }, (_, i) => ({
        ...template,
        path: `cache-${String(i).padStart(2, '0')}.gcode`,
        meta: { ...template.meta, thumbnails: [{ width: 160, height: 160, relative_path: `.thumbs/cache-${i}.png` }] },
      })) });
      await mock.install(page);
      await page.goto(`/?moonraker=${encodeURIComponent(MOONRAKER)}#/files`);
      await expect.poll(() => page.evaluate(() => window.thumbnailUrls.size)).toBe(40);
      const first = page.locator('.list img[alt="cache-00"]');
      await expect(first).toBeVisible();
      const original = await first.getAttribute('src');
      expect(original).toMatch(/^blob:/);
      await page.getByRole('button', { name: /cache-00/ }).click();
      const detail = page.getByRole('dialog').getByRole('img', { name: 'cache-00', exact: true });
      await expect(detail).toHaveAttribute('src', original!);
      expect(mock.thumbnailRequests.filter(path => path.endsWith('/cache-0.png'))).toHaveLength(1);
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      expect(await page.evaluate(url => fetch(url!).then(r => r.ok), original)).toBe(true);

      await page.getByRole('button', { name: 'Refresh file list' }).click();
      await expect(page.locator('.list')).toHaveAttribute('aria-busy', 'false');
      await expect.poll(() => first.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      const refreshed = await first.getAttribute('src');
      expect(await page.evaluate(url => fetch(url!).then(r => r.ok), refreshed)).toBe(true);
      expect(await page.evaluate(url => window.revokedThumbnails.includes(url!), refreshed)).toBe(false);

      // Replace the current thumbnail's cache key and let Thumb release its old lease.
      mock.files[0]!.modified += 1;
      mock.notify('notify_filelist_changed', [{ action: 'modify_file', item: { root: 'gcodes', path: mock.files[0]!.path } }]);
      await expect(first).not.toHaveAttribute('src', refreshed!);
      await expect.poll(() => page.evaluate(url => window.revokedThumbnails.includes(url!), refreshed)).toBe(true);
      await expect.poll(() => first.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

      await page.getByRole('link', { name: 'Home', exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.thumbnailUrls.size)).toBeLessThanOrEqual(32);
      await expectCleanLayout(page);
      expect(await page.evaluate(() => window.unsafeRevocations)).toEqual([]);
      expect(mock.controlCalls).toEqual([]);
    });

    test('failed authenticated requests recover on navigation without stale images', async ({ page }) => {
      const mock = new MockMoonraker({ scenario: 'ready' });
      await mock.install(page);
      await page.route(/:7125\/server\/files\/gcodes\//, route => route.fulfill({ status: 503, body: 'Unavailable' }));
      await page.goto(`/?moonraker=${encodeURIComponent(MOONRAKER)}#/files`);
      await expect(page.getByRole('img', { name: 'cable_chain_mount_PETG (no preview)', exact: true })).toBeVisible();
      await page.getByRole('link', { name: 'Home', exact: true }).click();
      await page.unroute(/:7125\/server\/files\/gcodes\//);
      // Reinstall the fixture HTTP route after removing the failure route.
      await mock.install(page);
      await page.getByRole('link', { name: 'Files', exact: true }).click();
      const image = page.getByRole('img', { name: 'cable_chain_mount_PETG', exact: true });
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await expectCleanLayout(page);
      expect(mock.controlCalls).toEqual([]);
    });

    test('a late old download cannot replace a newer image after a cache-key change', async ({ page }) => {
      const template = defaultFiles()[0]!;
      const mock = new MockMoonraker({ scenario: 'ready', files: [{
        ...template, path: 'changing.gcode',
        meta: { ...template.meta, thumbnails: [{ width: 160, height: 160, relative_path: '.thumbs/changing.png' }] },
      }] });
      await mock.install(page);
      let release!: () => void;
      let arrived!: () => void;
      let finished!: () => void;
      const blocked = new Promise<void>(resolve => { release = resolve; });
      const waiting = new Promise<void>(resolve => { arrived = resolve; });
      const delivered = new Promise<void>(resolve => { finished = resolve; });
      await page.route(/:7125\/server\/files\/gcodes\//, async route => {
        const old = new URL(route.request().url()).searchParams.get('timestamp') === String(template.modified);
        if (old) {
          arrived(); await blocked;
        }
        await route.fulfill({ status: 200, contentType: 'image/png', body: partThumbnail(160, [62, 224, 240]) });
        if (old) finished();
      });
      try {
        await page.goto(`/?moonraker=${encodeURIComponent(MOONRAKER)}#/files`);
        await waiting;
        mock.files[0]!.modified += 1;
        mock.notify('notify_filelist_changed', [{ action: 'modify_file', item: { root: 'gcodes', path: 'changing.gcode' } }]);
        const image = page.getByRole('img', { name: 'changing', exact: true });
        await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        const current = await image.getAttribute('src');
        release(); await delivered;
        await page.evaluate(() => new Promise(requestAnimationFrame));
        await expect(image).toHaveAttribute('src', current!);
        expect(await page.evaluate(url => fetch(url!).then(r => r.ok), current)).toBe(true);
        expect(mock.controlCalls).toEqual([]);
      } finally { release(); }
    });
  });
}
