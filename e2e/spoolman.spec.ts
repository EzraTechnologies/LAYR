import { expect, test } from '@playwright/test';
import { seedIntegrations } from './integrationSeed';
import { expectCleanLayout, openWithMock, VIEWPORTS } from './helpers';
import { MOONRAKER, type MockMoonraker } from './mockMoonraker';

async function spoolPosts(mock: MockMoonraker) {
  return mock.calls.filter((call) => call.method === 'server.spoolman.post_spool_id');
}

test.describe('Spoolman switched off', () => {
  test('keeps the original Extrude screen and does not call Spoolman', async ({ page }) => {
    const mock = await openWithMock(page, 'extrude', { scenario: 'ready', homed: true, spoolman: 'ready' });
    await expect(page.getByText('Spool tracking with Spoolman is planned for a later release.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Galaxy Black/ })).toHaveCount(0);
    expect(mock.calls.some((call) => call.method.startsWith('server.spoolman'))).toBe(false);
    expect(mock.scripts).toEqual([]);
  });
});

test.describe('Spoolman switched off after use', () => {
  test.beforeEach(async ({ page }) => {
    await seedIntegrations(page, { spoolman: true }, MOONRAKER);
  });

  test('turning the switch off hides the spool and stops Spoolman calls', async ({ page }) => {
    const mock = await openWithMock(page, 'extrude', { scenario: 'ready', homed: true, spoolman: 'ready' });
    await expect(page.getByRole('button', { name: /Galaxy Black/ })).toBeVisible();
    const before = mock.calls.filter((call) => call.method.startsWith('server.spoolman')).length;
    expect(before).toBeGreaterThan(0);
    await page.getByRole('link', { name: 'Settings' }).click();
    const toggle = page.locator('[data-integration="spoolman"]');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('link', { name: 'Extrude' }).click();
    await expect(page.getByText('Spool tracking with Spoolman is planned for a later release.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Galaxy Black/ })).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(mock.calls.filter((call) => call.method.startsWith('server.spoolman'))).toHaveLength(before);
    expect(mock.scripts).toEqual([]);
  });
});

test.describe('Spoolman', () => {
  test.beforeEach(async ({ page }) => {
    await seedIntegrations(page, { spoolman: true }, MOONRAKER);
  });

  test('printers without Spoolman keep the current extrude screen and send no spool calls', async ({ page }) => {
    const mock = await openWithMock(page, 'extrude', { scenario: 'ready', homed: true });
    await expect(page.getByText('Spool tracking with Spoolman is planned for a later release.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Galaxy Black/ })).toHaveCount(0);
    expect(mock.calls.some((call) => call.method.startsWith('server.spoolman'))).toBe(false);
    await expect(page.getByRole('status', { name: /Printer status/ })).not.toHaveText(/Offline/);
  });

  test('probes the documented API when server.info omits components', async ({ page }) => {
    const mock = await openWithMock(page, 'extrude', { scenario: 'ready', spoolman: 'ready', omitComponents: true });
    await expect(page.getByRole('button', { name: /Galaxy Black/ })).toBeVisible();
    expect(mock.calls.some((call) => call.method === 'server.spoolman.status')).toBe(true);
  });

  test('shows the active spool and selects another only after confirmation', async ({ page }) => {
    const mock = await openWithMock(page, 'extrude', { scenario: 'ready', homed: true, spoolman: 'ready' });
    const active = page.getByRole('button', { name: /Galaxy Black/ });
    await expect(active).toBeVisible();
    await expect(active).toContainText('ASA');
    await expect(active).toContainText('842 g');
    await expect(active).toContainText('311 m');
    await active.click();
    await expect(page.getByRole('dialog', { name: 'Spools' })).toBeVisible();
    await page.getByRole('button', { name: /Arctic White/ }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Use Arctic White?');
    await page.getByRole('button', { name: 'Go back' }).click();
    expect(await spoolPosts(mock)).toEqual([]);

    await page.getByRole('button', { name: /Arctic White/ }).click();
    await page.getByRole('button', { name: 'Set active spool' }).click();
    await expect.poll(async () => spoolPosts(mock)).toEqual([{ method: 'server.spoolman.post_spool_id', params: { spool_id: 8 } }]);
    await expect(page.getByRole('dialog', { name: 'Spools' }).getByRole('button', { name: /Arctic White/ })).toContainText('Active');
    await page.getByRole('button', { name: 'Close spools' }).click();
    await expect(page.getByRole('region', { name: 'Runout sensors' }).getByRole('button', { name: /Arctic White/ })).toBeVisible();
  });

  test('locks spool changes while printing and still shows the active spool on the job', async ({ page }) => {
    const mock = await openWithMock(page, 'home', { scenario: 'printing', spoolman: 'ready' });
    await expect(page.getByText(/Galaxy Black/)).toBeVisible();
    await expect(page.getByText(/842 g/)).toBeVisible();
    await page.getByRole('link', { name: 'Extrude' }).click();
    await page.getByRole('button', { name: /Galaxy Black/ }).click();
    const other = page.getByRole('button', { name: /Arctic White/ });
    await expect(other).toBeDisabled();
    await other.click({ force: true });
    expect(await spoolPosts(mock)).toEqual([]);
    await expect(page.getByText('Spool changes are locked while a print is running.')).toBeVisible();
  });

  test('hides weights when Spoolman is offline', async ({ page }) => {
    await openWithMock(page, 'extrude', { scenario: 'ready', spoolman: 'offline' });
    await expect(page.getByRole('button', { name: /Spoolman offline/ })).toBeVisible();
    await expect(page.getByText('842')).toHaveCount(0);
    await expect(page.getByText(/not reachable/)).toBeVisible();
  });

  test('hides weights when Spoolman refuses the connection', async ({ page }) => {
    await openWithMock(page, 'extrude', { scenario: 'ready', spoolman: 'unauthorized' });
    await expect(page.getByRole('button', { name: /Spoolman unauthorized/ })).toBeVisible();
    await expect(page.getByText(/API key/)).toBeVisible();
    await expect(page.getByText('842')).toHaveCount(0);
  });

  test('drops the catalogue when Moonraker disconnects and loads the next connection’s spools', async ({ page }) => {
    const mock = await openWithMock(page, 'extrude', { scenario: 'ready', spoolman: 'ready' });
    await expect(page.getByRole('button', { name: /Galaxy Black/ })).toBeVisible();
    await mock.disconnect();
    await expect(page.getByText('Galaxy Black')).toHaveCount(0);
    await expect(page.getByText('842')).toHaveCount(0);
    await expect(page.getByText(/hidden until this printer is connected/)).toBeVisible();

    mock.spools = [{ id: 9, name: 'Only On B', material: 'PLA', vendor: 'Acme', color: '3366ff', remainingWeight: 50, remainingLength: 20_000 }];
    mock.activeSpoolId = 9;
    mock.online = true;
    await expect(page.getByRole('button', { name: /Only On B/ })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Galaxy Black')).toHaveCount(0);
    await expect(page.getByText(/50 g/)).toBeVisible();
  });

  test('clears the active spool only after Klipper accepts the unload', async ({ page }) => {
    const mock = await openWithMock(page, 'extrude', { scenario: 'ready', homed: true, spoolman: 'ready' });
    await expect(page.getByRole('button', { name: /Galaxy Black/ })).toBeVisible();
    await page.getByRole('button', { name: 'Unload' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('active spool is cleared');
    await page.getByRole('button', { name: 'Go back' }).click();
    expect(mock.scripts).toEqual([]);
    expect(await spoolPosts(mock)).toEqual([]);

    await page.getByRole('button', { name: 'Unload' }).click();
    await page.getByRole('button', { name: 'Run macro' }).click();
    await expect.poll(async () => spoolPosts(mock)).toEqual([{ method: 'server.spoolman.post_spool_id', params: { spool_id: null } }]);
    await expect(page.getByRole('button', { name: /No active spool/ })).toBeVisible();
  });

  test('keeps the active spool when the unload fails', async ({ page }) => {
    const mock = await openWithMock(page, 'extrude', { scenario: 'ready', homed: true, spoolman: 'ready', failScripts: ['UNLOAD_FILAMENT'] });
    await expect(page.getByRole('button', { name: /Galaxy Black/ })).toBeVisible();
    await page.getByRole('button', { name: 'Unload' }).click();
    await page.getByRole('button', { name: 'Run macro' }).click();
    await expect(page.getByText(/Active spool kept|spool was kept/)).toBeVisible();
    expect(await spoolPosts(mock)).toEqual([]);
    await expect(page.getByRole('button', { name: /Galaxy Black/ })).toBeVisible();
  });

  test('compares a file’s material with the active spool', async ({ page }) => {
    await openWithMock(page, 'files', { scenario: 'ready', spoolman: 'ready' });
    await page.getByRole('button', { name: /cable_chain_mount_PETG/ }).click();
    await expect(page.getByRole('dialog')).toContainText(/Active spool/);
    await expect(page.getByText('This file asks for PETG. The active spool is ASA.')).toBeVisible();
  });

  for (const vp of VIEWPORTS) {
    test(`layout ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openWithMock(page, 'home', { scenario: 'ready', homed: true, spoolman: 'ready' });
      await expect(page.getByRole('link', { name: /Galaxy Black/ })).toBeVisible();
      await expectCleanLayout(page);

      await page.getByRole('link', { name: 'Extrude' }).click();
      await expect(page.getByRole('button', { name: /Galaxy Black/ })).toBeVisible();
      await expectCleanLayout(page);
      await page.getByRole('button', { name: /Galaxy Black/ }).click();
      await expect(page.getByRole('dialog', { name: 'Spools' })).toBeVisible();
      await expectCleanLayout(page);

      await page.getByRole('button', { name: 'Close spools' }).click();
      await page.getByRole('link', { name: 'Files' }).click();
      await page.getByRole('button', { name: /cable_chain_mount_PETG/ }).click();
      await expect(page.getByText(/Active spool/)).toBeVisible();
      await expectCleanLayout(page);
    });

    test(`layout ${vp.name} offline`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openWithMock(page, 'extrude', { scenario: 'ready', spoolman: 'offline' });
      await expect(page.getByRole('button', { name: /Spoolman offline/ })).toBeVisible();
      await expectCleanLayout(page);
    });

    test(`layout ${vp.name} printing`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openWithMock(page, 'home', { scenario: 'printing', spoolman: 'ready' });
      await expect(page.getByText(/Galaxy Black/)).toBeVisible();
      await expectCleanLayout(page);
    });
  }
});
