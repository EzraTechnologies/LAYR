import { expect, test } from '@playwright/test';
import { expectCleanLayout, VIEWPORTS } from './helpers';
import { MockMoonraker, MOONRAKER } from './mockMoonraker';

for (const vp of VIEWPORTS) {
  test.describe(`Files reliability ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('persistent initial failure stays visible and manual retry recovers', async ({ page }) => {
      const mock = new MockMoonraker({ scenario: 'ready' });
      mock.directoryFailure = 'File service unavailable';
      await mock.install(page);
      await page.goto(`/?moonraker=${encodeURIComponent(MOONRAKER)}#/files`);
      await expect(page.getByText('File service unavailable', { exact: true })).toBeVisible();
      const reads = () => mock.calls.filter(call => call.method === 'server.files.get_directory').length;
      expect(reads()).toBe(1);
      await page.clock.install();
      await page.clock.fastForward(30_000);
      expect(reads()).toBe(1);
      await expect(page.getByText('File service unavailable', { exact: true })).toBeVisible();
      await expectCleanLayout(page);
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect.poll(reads).toBe(2);
      await expect(page.getByText('File service unavailable', { exact: true })).toBeVisible();
      mock.directoryFailure = null;
      await page.getByRole('button', { name: 'Refresh file list' }).click();
      await expect(page.getByRole('button', { name: /cable_chain_mount_PETG/ })).toBeVisible();
      await page.getByRole('button', { name: /stealthburner/, exact: false }).click();
      await expect(page.getByRole('button', { name: /SB_cowling/ })).toBeVisible();
      await page.getByRole('button', { name: 'Up one folder' }).click();
      await expect(page.getByRole('button', { name: /cable_chain_mount_PETG/ })).toBeVisible();
      await expectCleanLayout(page);
      expect(mock.controlCalls).toEqual([]);
    });

    test('failed initial load recovers on real reconnect and one attempt per navigation', async ({ page }) => {
      const mock = new MockMoonraker({ scenario: 'ready' });
      mock.directoryFailure = 'Directory failure';
      await mock.install(page);
      await page.goto(`/?moonraker=${encodeURIComponent(MOONRAKER)}#/files`);
      await expect(page.getByText('Directory failure', { exact: true })).toBeVisible();
      await page.getByRole('link', { name: 'Home', exact: true }).click();
      await page.getByRole('link', { name: 'Files', exact: true }).click();
      await expect.poll(() => mock.calls.filter(call => call.method === 'server.files.get_directory').length).toBe(2);
      await mock.disconnect();
      await expect(page.getByText('Printer is offline', { exact: true })).toBeVisible();
      mock.directoryFailure = null;
      mock.online = true;
      await expect(page.getByRole('button', { name: /cable_chain_mount_PETG/ })).toBeVisible({ timeout: 10_000 });
      expect(mock.calls.filter(call => call.method === 'server.files.get_directory')).toHaveLength(3);
      expect(mock.controlCalls).toEqual([]);
    });

    test('file-change notifications recover a failure without creating a retry loop', async ({ page }) => {
      const mock = new MockMoonraker({ scenario: 'ready' });
      mock.directoryFailure = 'Directory failure';
      await mock.install(page);
      await page.goto(`/?moonraker=${encodeURIComponent(MOONRAKER)}#/files`);
      await expect(page.getByText('Directory failure', { exact: true })).toBeVisible();
      mock.directoryFailure = null;
      for (let i = 0; i < 3; i++) mock.notify('notify_filelist_changed', [{ action: 'create_file', item: { root: 'gcodes', path: 'new.gcode' } }]);
      await expect(page.getByRole('button', { name: /cable_chain_mount_PETG/ })).toBeVisible();
      expect(mock.calls.filter(call => call.method === 'server.files.get_directory')).toHaveLength(2);
      expect(mock.controlCalls).toEqual([]);
    });
  });
}
