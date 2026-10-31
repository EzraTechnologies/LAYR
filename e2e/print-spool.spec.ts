import { expect, test, type Page } from '@playwright/test';
import { expectCleanLayout, openWithMock, VIEWPORTS } from './helpers';
import { MockMoonraker, MOONRAKER } from './mockMoonraker';

const FILE = 'cable_chain_mount_PETG.gcode';
const starts = (mock: MockMoonraker) => mock.controlCalls.filter(call => call.method === 'printer.print.start');
const posts = (mock: MockMoonraker) => mock.controlCalls.filter(call => call.method === 'server.spoolman.post_spool_id');

async function printButton(page: Page) {
  await page.getByRole('button', { name: /cable_chain_mount_PETG/ }).click();
  return page.getByRole('button', { name: 'Print', exact: true });
}

async function missingSpool(page: Page) {
  const mock = await openWithMock(page, 'files', {
    scenario: 'ready', spoolman: 'ready', activeSpoolId: null, seedSwitches: { spoolman: true },
  });
  await expect(page.getByRole('link', { name: /Files/, exact: true })).toBeVisible();
  const button = await printButton(page);
  await expect(page.getByText('No active spool', { exact: true })).toBeVisible();
  await button.click();
  await expect(page.getByRole('dialog', { name: 'No active spool selected' })).toBeVisible();
  return mock;
}

for (const vp of VIEWPORTS) {
  test.describe(`print spool workflow ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('selecting a spool returns to normal confirmation for the same file', async ({ page }) => {
      const mock = await missingSpool(page);
      await expectCleanLayout(page);
      await page.getByRole('button', { name: 'Select spool', exact: true }).click();
      await expectCleanLayout(page);
      await page.getByRole('button', { name: /Arctic White/ }).click();
      await expect(page.getByRole('alertdialog')).toContainText('Filament in the toolhead is not moved');
      await page.getByRole('button', { name: 'Set active spool' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Start this print?' })).toContainText(FILE);
      expect(starts(mock)).toEqual([]);
      expect(posts(mock)).toHaveLength(1);
      expect(mock.scripts).toEqual([]);
      await expectCleanLayout(page);
      await page.getByRole('button', { name: 'Start print', exact: true }).click();
      await expect.poll(() => starts(mock)).toEqual([{ method: 'printer.print.start', params: { filename: FILE } }]);
      expect(mock.controlCalls.map(call => call.method)).toEqual(['server.spoolman.post_spool_id', 'printer.print.start']);
    });

    test('print without tracking still confirms and repeated taps send one start', async ({ page }) => {
      const mock = await missingSpool(page);
      await page.getByRole('button', { name: 'Print', exact: true }).evaluate(button => {
        for (let i = 0; i < 4; i++) button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await expect(page.getByRole('dialog', { name: 'No active spool selected' })).toHaveCount(1);
      await page.getByRole('button', { name: 'Print without tracking', exact: true }).evaluate(button => {
        for (let i = 0; i < 4; i++) button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await expect(page.getByRole('alertdialog', { name: 'Start this print?' })).toBeVisible();
      expect(mock.controlCalls).toEqual([]);
      await page.getByRole('button', { name: 'Start print', exact: true }).evaluate(button => {
        for (let i = 0; i < 4; i++) button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await expect.poll(() => starts(mock).length).toBe(1);
      expect(posts(mock)).toEqual([]);
      expect(mock.scripts).toEqual([]);
    });

    test('cancel and closing the spool browser abandon the pending print', async ({ page }) => {
      const mock = await missingSpool(page);
      await page.getByRole('dialog', { name: 'No active spool selected' }).getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Print', exact: true }).click();
      await page.getByRole('button', { name: 'Select spool', exact: true }).click();
      await page.getByRole('button', { name: 'Close spools' }).click();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
      expect(mock.controlCalls).toEqual([]);
    });

    test('failed selection keeps the browser open and never starts printing', async ({ page }) => {
      const mock = await missingSpool(page);
      mock.failSpoolWrites = true;
      await page.getByRole('button', { name: 'Select spool', exact: true }).click();
      await page.getByRole('button', { name: /Arctic White/ }).click();
      await page.getByRole('button', { name: 'Set active spool' }).click();
      await expect(page.getByText('Could not set the active spool')).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'Spools', exact: true })).toBeVisible();
      expect(starts(mock)).toEqual([]);
      expect(mock.scripts).toEqual([]);
      mock.failSpoolWrites = false;
      await page.getByRole('button', { name: /Arctic White/ }).click();
      await page.getByRole('button', { name: 'Set active spool' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Start this print?' })).toBeVisible();
      await page.getByRole('button', { name: 'Go back', exact: true }).click();
      expect(starts(mock)).toEqual([]);
    });

    test('disabled Spoolman retains the ordinary print confirmation', async ({ page }) => {
      const mock = await openWithMock(page, 'files', { scenario: 'ready', spoolman: 'ready', activeSpoolId: null });
      await (await printButton(page)).click();
      await expect(page.getByRole('alertdialog', { name: 'Start this print?' })).toContainText(FILE);
      expect(mock.calls.some(call => call.method.startsWith('server.spoolman'))).toBe(false);
      await page.getByRole('button', { name: 'Go back', exact: true }).click();
      expect(starts(mock)).toEqual([]);
    });

    for (const mode of ['offline', 'absent', 'unauthorized'] as const) {
      test(`${mode} Spoolman explains uncertainty and permits printing`, async ({ page }) => {
        const mock = await openWithMock(page, 'files', { scenario: 'ready', spoolman: mode, seedSwitches: { spoolman: true } });
        await (await printButton(page)).click();
        const dialog = page.getByRole('dialog', { name: 'Spool tracking unavailable' });
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('cannot be verified');
        await expect(dialog.getByRole('button', { name: 'Select spool', exact: true })).toHaveCount(0);
        await expectCleanLayout(page);
        await dialog.getByRole('button', { name: 'Print without tracking', exact: true }).click();
        await expect(page.getByRole('alertdialog', { name: 'Start this print?' })).toContainText(FILE);
        await page.getByRole('button', { name: 'Start print', exact: true }).click();
        await expect.poll(() => starts(mock).length).toBe(1);
        expect(posts(mock)).toEqual([]);
      });
    }

    test('an already active spool preserves ordinary print confirmation', async ({ page }) => {
      const mock = await openWithMock(page, 'files', { scenario: 'ready', spoolman: 'ready', seedSwitches: { spoolman: true } });
      const button = await printButton(page);
      await expect(page.getByText(/Galaxy Black/)).toBeVisible();
      await button.click();
      await expect(page.getByRole('alertdialog', { name: 'Start this print?' })).toBeVisible();
      expect(posts(mock)).toEqual([]);
      expect(starts(mock)).toEqual([]);
    });

    test('an unresolved initial read is unknown rather than no selected spool', async ({ page }) => {
      let release!: () => void;
      const mock = new MockMoonraker({ scenario: 'ready', spoolman: 'ready', seedSwitches: { spoolman: true } });
      mock.spoolReadGate = new Promise<void>(resolve => { release = resolve; });
      await mock.install(page);
      try {
        await page.goto(`/?moonraker=${encodeURIComponent(MOONRAKER)}#/files`);
        await (await printButton(page)).click();
        const dialog = page.getByRole('dialog', { name: 'Spool tracking unavailable' });
        await expect(dialog).toContainText('cannot be verified');
        await expect(dialog.getByRole('button', { name: 'Select spool', exact: true })).toHaveCount(0);
        await expectCleanLayout(page);
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        expect(mock.controlCalls).toEqual([]);
      } finally { release(); }
    });

    test('a replaced file cannot start from an earlier confirmation', async ({ page }) => {
      const mock = await missingSpool(page);
      await page.getByRole('button', { name: 'Print without tracking', exact: true }).click();
      await expect(page.getByRole('alertdialog', { name: 'Start this print?' })).toBeVisible();
      const file = mock.files.find(file => file.path === FILE)!;
      file.modified += 100;
      file.size += 1000;
      mock.notify('notify_filelist_changed', [{ action: 'modify_file', item: { root: 'gcodes', path: FILE } }]);
      // The invalidated request re-enables the underlying Print button only after the reload.
      await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Start print', exact: true }).click();
      expect(starts(mock)).toEqual([]);
    });

    test('connection loss invalidates a pending confirmation', async ({ page }) => {
      const mock = await missingSpool(page);
      await page.getByRole('button', { name: 'Print without tracking', exact: true }).click();
      await expect(page.getByRole('alertdialog', { name: 'Start this print?' })).toBeVisible();
      await mock.disconnect();
      await expect(page.getByRole('status', { name: /Printer status/ })).toHaveText(/Offline/);
      await page.getByRole('button', { name: 'Start print', exact: true }).click();
      expect(starts(mock)).toEqual([]);
    });

    test('a removed file cannot start from a stale confirmation', async ({ page }) => {
      const mock = await missingSpool(page);
      await page.getByRole('button', { name: 'Print without tracking', exact: true }).click();
      await expect(page.getByRole('alertdialog', { name: 'Start this print?' })).toBeVisible();
      mock.files = mock.files.filter(file => file.path !== FILE);
      mock.notify('notify_filelist_changed', [{ action: 'delete_file', item: { root: 'gcodes', path: FILE } }]);
      await expect(page.locator('.list').getByRole('button', { name: /cable_chain_mount_PETG/ })).toHaveCount(0);
      await page.getByRole('button', { name: 'Start print', exact: true }).click();
      expect(starts(mock)).toEqual([]);
    });

    test('navigation during selection cannot start an abandoned file', async ({ page }) => {
      const mock = await missingSpool(page);
      await page.getByRole('button', { name: 'Select spool', exact: true }).click();
      await page.getByRole('button', { name: /Arctic White/ }).click();
      await page.evaluate(() => { location.hash = '#/home'; });
      await expect(page.getByRole('button', { name: 'Browse files' })).toBeVisible();
      await page.getByRole('button', { name: 'Set active spool' }).click();
      await page.getByRole('button', { name: 'Browse files' }).click();
      await page.getByRole('button', { name: /no_preview_bracket/ }).click();
      await page.getByRole('button', { name: 'Print', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'No active spool selected' })).toBeVisible();
      await page.getByRole('button', { name: 'Print without tracking', exact: true }).click();
      await expect(page.getByRole('alertdialog', { name: 'Start this print?' })).toContainText('no_preview_bracket.gcode');
      expect(mock.controlCalls).toEqual([]);
    });
  });
}
