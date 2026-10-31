import { expect, test } from '@playwright/test';
import { MockMoonraker, MOONRAKER } from './mockMoonraker';
import { expectCleanLayout, VIEWPORTS } from './helpers';
import { partThumbnail } from './png';

for (const vp of VIEWPORTS) {
  test.describe(`HTTP connection stability ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('a hanging token request times out, aborts, and recovers with a fresh token', async ({ page }) => {
      await page.clock.install();
      const mock = new MockMoonraker({ scenario: 'ready' }); await mock.install(page);
      let release!: () => void; let requests = 0;
      const blocked = new Promise<void>(resolve => { release = resolve; });
      const failed: string[] = [];
      page.on('requestfailed', request => failed.push(request.url()));
      await page.route(/:7125\/access\/oneshot_token/, async route => {
        requests += 1;
        if (requests === 1) await blocked;
        await route.fulfill({ json: { result: requests === 1 ? 'old-token' : 'fresh-token' } });
      });
      try {
        await page.goto(`/?moonraker=${encodeURIComponent(MOONRAKER)}#/home`);
        await expect.poll(() => requests).toBe(1);
        await page.clock.fastForward(10_100);
        await expect(page.getByRole('status', { name: /Printer status/ })).toHaveText(/Offline/);
        await expect.poll(() => failed.some(url => url.includes('oneshot_token'))).toBe(true);
        await page.clock.runFor(1_100);
        await expect(page.getByRole('button', { name: 'Browse files' })).toBeVisible();
        release(); await page.evaluate(() => new Promise(requestAnimationFrame));
        expect(mock.socketCount).toBe(1);
        expect(mock.controlCalls).toEqual([]);
        await expectCleanLayout(page);
      } finally { release(); }
    });

    test('a thumbnail deadline aborts the request and Refresh recovers', async ({ page }) => {
      await page.clock.install();
      const mock = new MockMoonraker({ scenario: 'ready' }); await mock.install(page);
      let stalled = true; let requests = 0; let release!: () => void;
      const blocked = new Promise<void>(resolve => { release = resolve; });
      const failed: string[] = [];
      page.on('requestfailed', request => failed.push(request.url()));
      await page.route(/:7125\/server\/files\/gcodes\//, async route => {
        requests += 1;
        if (stalled) await blocked;
        await route.fulfill({ status: 200, contentType: 'image/png', body: partThumbnail(160, [62, 224, 240]) });
      });
      try {
        await page.goto(`/?moonraker=${encodeURIComponent(MOONRAKER)}#/files`);
        await expect.poll(() => requests).toBeGreaterThan(0);
        await page.clock.fastForward(10_100);
        await expect(page.getByRole('img', { name: 'cable_chain_mount_PETG (no preview)', exact: true })).toBeVisible();
        await expect.poll(() => failed.some(url => url.includes('/server/files/gcodes/'))).toBe(true);
        stalled = false;
        await page.getByRole('button', { name: 'Refresh file list' }).click();
        const image = page.getByRole('img', { name: 'cable_chain_mount_PETG', exact: true });
        await expect(image).toBeVisible();
        await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        const current = await image.getAttribute('src');
        release(); await page.evaluate(() => new Promise(requestAnimationFrame));
        await expect(image).toHaveAttribute('src', current!);
        expect(mock.socketCount).toBe(1);
        expect(mock.controlCalls).toEqual([]);
        await expectCleanLayout(page);
      } finally { release(); }
    });

    test('leaving Files aborts thumbnail downloads without disconnecting the printer', async ({ page }) => {
      const mock = new MockMoonraker({ scenario: 'ready' }); await mock.install(page);
      let requests = 0; let release!: () => void;
      const blocked = new Promise<void>(resolve => { release = resolve; });
      const failed: string[] = [];
      page.on('requestfailed', request => failed.push(request.url()));
      await page.route(/:7125\/server\/files\/gcodes\//, async route => {
        requests += 1; await blocked;
        await route.fulfill({ status: 200, contentType: 'image/png', body: partThumbnail(160, [62, 224, 240]) });
      });
      try {
        await page.goto(`/?moonraker=${encodeURIComponent(MOONRAKER)}#/files`);
        await expect.poll(() => requests).toBeGreaterThan(0);
        await page.getByRole('link', { name: 'Home', exact: true }).click();
        await expect.poll(() => failed.filter(url => url.includes('/server/files/gcodes/')).length).toBe(requests);
        await expect(page.getByRole('button', { name: 'Browse files' })).toBeVisible();
        expect(mock.socketCount).toBe(1);
        expect(mock.controlCalls).toEqual([]);
      } finally { release(); }
    });
  });
}
