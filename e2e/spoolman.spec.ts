import { expect, test } from '@playwright/test';
import { expectCleanLayout, openWithMock, VIEWPORTS } from './helpers';

test.describe('Spoolman', () => {
  test('printers without Spoolman keep the existing navigation', async ({ page }) => {
    await openWithMock(page, 'extrude', { scenario: 'ready', homed: true });
    await expect(page.getByRole('link', { name: 'Spools' })).toHaveCount(0);
    await expect(page.getByText('Spool tracking with Spoolman is planned for a later release.')).toBeVisible();
  });

  test('shows the active spool, confirms a change, and sends nothing if you go back', async ({ page }) => {
    const mock = await openWithMock(page, 'filament', { scenario: 'ready', homed: true, spoolman: 'ready' });
    await expect(page.getByRole('link', { name: 'Spools' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('Galaxy Orange', { exact: true })).toBeVisible();
    await expect(page.getByText('420 g left').first()).toBeVisible();
    await expect(page.getByText('Weight not reported')).toBeVisible();
    await expect(page.getByText('Empty PETG')).toHaveCount(0);

    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(page.getByText('Empty PETG')).toBeVisible();

    const use = page.getByRole('listitem').filter({ hasText: 'PolyTerra Black' }).getByRole('button', { name: 'Use' });
    await use.click();
    await expect(page.getByRole('alertdialog')).toContainText('PolyTerra Black');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Go back' }).click();
    expect(mock.calls.filter((call) => call.method === 'server.spoolman.post_spool_id')).toEqual([]);

    await use.click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Set active spool' }).click();
    await expect.poll(() => mock.calls.some((call) => call.method === 'server.spoolman.post_spool_id' && call.params?.spool_id === 1)).toBe(true);
  });

  test('does not change spools while printing', async ({ page }) => {
    const printing = await openWithMock(page, 'filament', { scenario: 'printing', spoolman: 'ready' });
    await expect(page.getByText(/print is active/i)).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'PolyTerra Black' }).getByRole('button', { name: 'Use' })).toBeDisabled();
    expect(printing.controlCalls.filter((call) => call.method === 'server.spoolman.post_spool_id')).toEqual([]);
  });

  test('keeps the spool when unload fails', async ({ page }) => {
    const mock = await openWithMock(page, 'filament', { scenario: 'ready', homed: true, spoolman: 'ready', failMacros: ['UNLOAD_FILAMENT'] });
    await expect(page.getByRole('button', { name: 'Unload' })).toBeEnabled();
    await page.getByRole('button', { name: 'Unload' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Run and clear if accepted' }).click();
    await expect(page.getByText('Active spool kept')).toBeVisible();
    expect(mock.calls.some((call) => call.method === 'server.spoolman.post_spool_id')).toBe(false);
  });

  test('shows an offline Spoolman without a spool list', async ({ page }) => {
    await openWithMock(page, 'filament', { scenario: 'ready', homed: true, spoolman: 'offline' });
    await expect(page.getByText(/cannot reach Spoolman/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use' })).toHaveCount(0);
    await expect(page.getByText('Galaxy Orange', { exact: true })).toHaveCount(0);
  });

  test('shows a Spoolman error without inventing a spool list', async ({ page }) => {
    await openWithMock(page, 'filament', { scenario: 'ready', homed: true, spoolman: 'error' });
    await expect(page.getByText(/database is locked/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use' })).toHaveCount(0);
  });

  test('clears the active spool only after Klipper accepts the unload', async ({ page }) => {
    const mock = await openWithMock(page, 'filament', { scenario: 'ready', homed: true, spoolman: 'ready' });
    await page.getByRole('button', { name: 'Unload' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Run and clear if accepted' }).click();
    await expect(page.getByText('Active spool cleared')).toBeVisible();
    const writes = mock.calls.filter((call) => call.method === 'server.spoolman.post_spool_id');
    expect(writes.map((call) => call.params?.spool_id)).toEqual([null]);
    expect(mock.scripts).toContain('UNLOAD_FILAMENT');
  });

  for (const vp of VIEWPORTS) {
    test(`layout ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openWithMock(page, 'filament', { scenario: 'ready', homed: true, spoolman: 'ready' });
      await expect(page.getByText('Galaxy Orange', { exact: true })).toBeVisible();
      await expectCleanLayout(page);
      await page.goto('/?moonraker=http://127.0.0.1:7125#/home');
      await expect(page.getByRole('link', { name: /Active spool/ })).toBeVisible();
      await expectCleanLayout(page);
    });
  }
});
