import { expect, test } from '@playwright/test';
import { expectCleanLayout, openWithMock, VIEWPORTS } from './helpers';
import { errorMmu, MMU_COMMANDS, partialMmu, printingMmu, readyMmu } from './mmuFixture';

test.describe('Happy Hare MMU', () => {
  test('stays hidden when the printer has no mmu object', async ({ page }) => {
    const mock = await openWithMock(page, 'mmu', { scenario: 'ready' });
    await expect(page.getByRole('heading', { name: 'No Happy Hare MMU' })).toBeVisible();
    await expect(page.getByText('did not list an mmu object')).toBeVisible();
    await expect(page.getByRole('link', { name: 'MMU', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Load' })).toHaveCount(0);
    expect(mock.calls.some((call) => call.method === 'printer.gcode.help')).toBe(false);
    expect(mock.controlCalls).toEqual([]);
    expect(mock.scripts).toEqual([]);
  });

  test('shows reported state and sends a tool change only after confirmation', async ({ page }) => {
    const mock = await openWithMock(page, 'mmu', { scenario: 'ready', mmu: { status: readyMmu() } });
    await expect(page.getByRole('link', { name: 'MMU', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Happy Hare' })).toBeVisible();
    await expect(page.getByText('Loaded in nozzle')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Gate 2, Available, selected' })).toBeVisible();
    await expect(page.getByLabel('Gate 2 details')).toContainText('PolyLite');

    const subscribed = mock.calls.find((call) => call.method === 'printer.objects.subscribe');
    const fields = (subscribed?.params?.objects as { mmu?: string[] } | undefined)?.mmu ?? [];
    expect(fields).toContain('tool');
    expect(fields).toContain('gate_status');
    expect(fields).not.toContain('nfc');
    expect(mock.calls.some((call) => call.method === 'printer.gcode.help')).toBe(true);

    await page.getByRole('radio', { name: 'Gate 0, Available' }).click();
    await page.getByRole('button', { name: 'Change to tool 0' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('MMU_CHANGE_TOOL TOOL=0');
    await page.getByRole('button', { name: 'Go back' }).click();
    expect(mock.scripts).toEqual([]);

    await page.getByRole('button', { name: 'Change to tool 0' }).click();
    await page.getByRole('button', { name: 'Change tool' }).click();
    await expect.poll(() => mock.scripts).toEqual(['MMU_CHANGE_TOOL TOOL=0']);
    expect(mock.scripts.filter((script) => script !== 'MMU_CHANGE_TOOL TOOL=0')).toEqual([]);
  });

  test('keeps load and unload off while printing', async ({ page }) => {
    const mock = await openWithMock(page, 'mmu', { scenario: 'printing', mmu: { status: printingMmu() } });
    await expect(page.getByText('Not available while printing')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Unload', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Load', exact: true }).click({ force: true });
    expect(mock.scripts).toEqual([]);
    expect(mock.controlCalls).toEqual([]);
  });

  test('shows a reported error and still asks before recover', async ({ page }) => {
    const mock = await openWithMock(page, 'mmu', { scenario: 'paused', mmu: { status: errorMmu() } });
    await expect(page.getByText('Filament clog on gate 2')).toBeVisible();
    await expect(page.getByText('MMU print state: pause_locked')).toBeVisible();
    await expect(page.getByText('Unknown', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Recover' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('MMU_RECOVER');
    await expect(page.getByRole('alertdialog')).toContainText('A print is paused.');
    await page.getByRole('button', { name: 'Go back' }).click();
    expect(mock.scripts).toEqual([]);
  });

  test('offers no moves when command help fails', async ({ page }) => {
    const failed = await openWithMock(page, 'mmu', { scenario: 'ready', mmu: { status: readyMmu(), commands: null } });
    await expect(page.getByText('Command list unavailable')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Unload', exact: true })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: /Gate 2/ })).toBeVisible();
    expect(failed.scripts).toEqual([]);
  });

  test('does not invent a gate list when Happy Hare omitted it', async ({ page }) => {
    await openWithMock(page, 'mmu', { scenario: 'ready', mmu: { status: partialMmu(), commands: [...MMU_COMMANDS] } });
    await expect(page.getByText('Gate count was not reported')).toBeVisible();
    await expect(page.getByText('No per-gate list was reported')).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(page.getByText('The MMU reports it is not homed')).toBeVisible();
  });

  test('shows no MMU values while Klipper is in error or the socket is down', async ({ page }) => {
    const shutdown = await openWithMock(page, 'mmu', { scenario: 'shutdown', mmu: { status: readyMmu() } });
    await expect(page.getByText('Klipper is not ready')).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'MMU', exact: true })).toHaveCount(0);
    expect(shutdown.scripts).toEqual([]);

    await page.goto('/?moonraker=http://127.0.0.1:9#/mmu');
    await expect(page.getByText('Printer is offline. MMU state is not shown')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('radio')).toHaveCount(0);
  });

  for (const vp of VIEWPORTS) {
    test(`layout ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openWithMock(page, 'home', { scenario: 'printing', mmu: { status: printingMmu() } });
      await expect(page.getByRole('link', { name: /Happy Hare/ })).toBeVisible();
      await expectCleanLayout(page);
      await page.getByRole('link', { name: 'MMU', exact: true }).click();
      await expectCleanLayout(page);

      await openWithMock(page, 'mmu', { scenario: 'paused', mmu: { status: errorMmu() } });
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await expectCleanLayout(page);
    });
  }
});
