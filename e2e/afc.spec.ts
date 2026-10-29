import { expect, test, type Page } from '@playwright/test';
import { seedIntegrations } from './integrationSeed';
import { expectCleanLayout, openWithMock, VIEWPORTS } from './helpers';
import { MOONRAKER, type AfcScenario } from './mockMoonraker';

async function confirm(page: Page, label: string) {
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: label }).click();
  await expect(dialog).toBeHidden();
}

test.describe('AFC switched off', () => {
  test('ignores a listed AFC object until Settings turns AFC on', async ({ page }) => {
    const mock = await openWithMock(page, 'afc', { scenario: 'ready', homed: true, afc: 'ready' });
    await expect(page).toHaveURL(/#\/home$/);
    await expect(page.getByRole('link', { name: 'AFC', exact: true })).toHaveCount(0);
    const subscribed = mock.calls.find((call) => call.method === 'printer.objects.subscribe')?.params?.objects as Record<string, unknown>;
    expect(subscribed).not.toHaveProperty('AFC');
    expect(subscribed).not.toHaveProperty('AFC_lane lane1');
    expect(mock.calls.some((call) => call.method === 'printer.gcode.help')).toBe(false);
    expect(mock.scripts).toEqual([]);
  });
});

test.describe('AFC', () => {
  test.beforeEach(async ({ page }) => {
    await seedIntegrations(page, { afc: true }, MOONRAKER);
  });

  test('shows lanes from the subscription and sends a load only after confirmation', async ({ page }) => {
    const mock = await openWithMock(page, 'afc', { scenario: 'ready', homed: true, afc: 'ready' });
    await expect(page.getByRole('link', { name: 'AFC', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('status').filter({ hasText: 'Idle' })).toBeVisible();
    await expect(page.getByText('Loaded lane2')).toBeVisible();
    await expect(page.getByText('Box Turtle · Turtle_1')).toBeVisible();
    await expect(page.getByText('In Tool · Tooled')).toBeVisible();
    await expect(page.getByText('Polymaker ABS')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change lane4' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Unload lane2' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Eject lane3' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Load lane1' })).toHaveCount(0);

    const subscribed = mock.calls.find((call) => call.method === 'printer.objects.subscribe')?.params?.objects as Record<string, unknown>;
    expect(subscribed.AFC).toEqual(expect.arrayContaining(['current_load', 'current_state', 'error_state', 'lanes', 'message']));
    expect(subscribed['AFC_lane lane4']).toEqual(expect.arrayContaining(['prep', 'filament_status', 'color']));
    expect(subscribed).not.toHaveProperty('mmu');
    expect(mock.calls.filter((call) => call.method === 'printer.gcode.help')).toHaveLength(1);

    await page.getByRole('button', { name: 'Change lane4' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Filament will move');
    await expect(page.getByRole('alertdialog')).toContainText('lane4');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Go back' }).click();
    expect(mock.scripts).toEqual([]);

    await page.getByRole('button', { name: 'Change lane4' }).click();
    await confirm(page, 'Change tool');
    await expect(page.getByText('Loaded lane4')).toBeVisible();
    expect(mock.scripts).toEqual(['CHANGE_TOOL LANE=lane4']);

    await page.getByRole('button', { name: 'Unload lane4' }).click();
    await confirm(page, 'Unload lane');
    await expect(page.getByText('Nothing loaded')).toBeVisible();
    await page.getByRole('button', { name: 'Load lane4', exact: true }).click();
    await confirm(page, 'Load lane');
    await expect(page.getByText('Loaded lane4', { exact: true })).toBeVisible();
    expect(mock.scripts).toEqual(['CHANGE_TOOL LANE=lane4', 'TOOL_UNLOAD LANE=lane4', 'TOOL_LOAD LANE=lane4']);
    expect(mock.calls.filter((call) => call.method === 'printer.gcode.help')).toHaveLength(1);

    mock.update({ AFC: { current_state: 'Loading', current_lane: 'lane1', error_state: false } });
    await expect(page.getByRole('status').filter({ hasText: 'Loading · lane1' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load lane4', exact: true })).toHaveCount(0);
    expect(mock.scripts).toEqual(['CHANGE_TOOL LANE=lane4', 'TOOL_UNLOAD LANE=lane4', 'TOOL_LOAD LANE=lane4']);
  });

  test('shows an AFC error and does not offer lane motion', async ({ page }) => {
    const error = await openWithMock(page, 'afc', { scenario: 'ready', homed: true, afc: 'error' });
    await expect(page.getByText('Filament failed to load to the toolhead')).toBeVisible();
    await expect(page.getByText('AFC is reporting an error')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change lane4' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Unload lane2' })).toHaveCount(0);
    expect(error.scripts).toEqual([]);
  });

  test('refuses lane motion during a print', async ({ page }) => {
    const printing = await openWithMock(page, 'afc', { scenario: 'printing', homed: true, afc: 'ready' });
    await expect(page.getByText('Not available during a print')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change lane4' })).toHaveCount(0);
    await expect(page.getByText('Loaded lane2')).toBeVisible();
    expect(printing.scripts).toEqual([]);
  });

  test('says AFC is absent instead of inventing lanes', async ({ page }) => {
    const mock = await openWithMock(page, 'afc', { scenario: 'ready', homed: true });
    await expect(page.getByRole('heading', { name: 'AFC is not installed' })).toBeVisible();
    await expect(page.getByText('does not install it')).toBeVisible();
    await expect(page.getByRole('link', { name: 'AFC', exact: true })).toHaveCount(0);
    await expect(page.getByText('lane1')).toHaveCount(0);
    expect(mock.calls.some((call) => call.method === 'printer.gcode.help')).toBe(false);
    const subscribed = mock.calls.find((call) => call.method === 'printer.objects.subscribe')?.params?.objects as Record<string, unknown>;
    expect(subscribed).not.toHaveProperty('AFC');
  });

  test('turning AFC off drops the subscription and leaves the AFC screen', async ({ page }) => {
    const mock = await openWithMock(page, 'afc', { scenario: 'ready', homed: true, afc: 'ready' });
    await expect(page.getByRole('link', { name: 'AFC', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: 'Settings' }).click();
    const toggle = page.locator('[data-integration="afc"]');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('link', { name: 'AFC', exact: true })).toHaveCount(0);
    await expect.poll(() => {
      const last = mock.calls.filter((call) => call.method === 'printer.objects.subscribe').at(-1);
      const objects = (last?.params?.objects ?? null) as Record<string, unknown> | null;
      return objects !== null && !Object.prototype.hasOwnProperty.call(objects, 'AFC') && !Object.prototype.hasOwnProperty.call(objects, 'AFC_lane lane1');
    }).toBe(true);
    await page.evaluate(() => {
      location.hash = '#/afc';
    });
    await expect(page).toHaveURL(/#\/home$/);
    expect(mock.scripts).toEqual([]);
    expect(mock.controlCalls).toEqual([]);
  });

  for (const vp of VIEWPORTS) {
    for (const mode of ['ready', 'loading', 'error'] as const satisfies readonly AfcScenario[]) {
      test(`layout ${vp.name} ${mode}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await openWithMock(page, 'afc', { scenario: 'ready', homed: true, afc: mode });
        await expect(page.getByRole('link', { name: 'AFC', exact: true })).toBeVisible();
        await expectCleanLayout(page);
      });
    }

    test(`layout ${vp.name} absent`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openWithMock(page, 'afc', { scenario: 'ready' });
      await expect(page.getByRole('heading', { name: 'AFC is not installed' })).toBeVisible();
      await expectCleanLayout(page);
    });
  }
});
