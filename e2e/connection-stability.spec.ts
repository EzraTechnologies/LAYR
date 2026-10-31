import { expect, test } from '@playwright/test';
import { expectCleanLayout, openWithMock, VIEWPORTS } from './helpers';
import { MockMoonraker, MOONRAKER } from './mockMoonraker';

for (const vp of VIEWPORTS) {
  test.describe(`connection stability ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('a quiet responsive printer remains connected during health checks', async ({ page }) => {
      await page.clock.install();
      const mock = await openWithMock(page, 'home', { scenario: 'printing' });
      const reads = mock.calls.filter(call => call.method === 'server.info').length;
      await page.clock.fastForward(15_100);
      await expect.poll(() => mock.calls.filter(call => call.method === 'server.info').length).toBeGreaterThan(reads);
      await page.evaluate(() => new Promise(requestAnimationFrame));
      await page.clock.runFor(10_100);
      await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      expect(mock.socketCount).toBe(1);
      expect(mock.controlCalls).toEqual([]);
      await expectCleanLayout(page);
    });

    test('silent socket recovery clears stale readings and never replays a control', async ({ page }) => {
      await page.clock.install();
      const mock = await openWithMock(page, 'move', { scenario: 'ready', homed: true });
      mock.silentMethods.add('server.info');
      mock.silentMethods.add('printer.gcode.script');
      await page.getByRole('button', { name: 'Home all', exact: true }).click();
      await expect.poll(() => mock.controlCalls.length).toBe(1);
      await page.clock.fastForward(15_100);
      await expect.poll(() => mock.calls.filter(call => call.method === 'server.info').length).toBeGreaterThan(1);
      await page.clock.fastForward(10_100);
      await expect(page.getByRole('status', { name: /Printer status/ })).toHaveText(/Offline/);
      await expect(page.getByRole('button', { name: 'Home all', exact: true })).toBeDisabled();
      await expect(page.getByText(/result unknown/)).toBeVisible();
      mock.silentMethods.clear();
      await page.clock.runFor(1_100);
      await expect(page.getByRole('status', { name: /Printer status/ })).toHaveText(/Ready/);
      await expect(page.getByRole('button', { name: 'Home all', exact: true })).toBeEnabled();
      expect(mock.socketCount).toBe(2);
      expect(mock.controlCalls).toEqual([{ method: 'printer.gcode.script', params: { script: 'G28' } }]);
      await expectCleanLayout(page);
    });

    test('a stalled initialization recovers through backoff without printer commands', async ({ page }) => {
      await page.clock.install();
      const mock = new MockMoonraker({ scenario: 'ready' });
      mock.silentMethods.add('server.info');
      await mock.install(page);
      await page.goto(`/?moonraker=${encodeURIComponent(MOONRAKER)}#/home`);
      await expect.poll(() => mock.calls.filter(call => call.method === 'server.info').length).toBe(1);
      await page.clock.fastForward(10_100);
      await expect(page.getByRole('status', { name: /Printer status/ })).toHaveText(/Offline/);
      mock.silentMethods.clear();
      await page.clock.runFor(1_100);
      await expect(page.getByRole('button', { name: 'Browse files' })).toBeVisible();
      expect(mock.socketCount).toBe(2);
      expect(mock.controlCalls).toEqual([]);
    });
  });
}
