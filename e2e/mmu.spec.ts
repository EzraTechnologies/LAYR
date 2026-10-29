import { expect, test } from '@playwright/test';
import { expectCleanLayout, openWithMock, VIEWPORTS } from './helpers';

test.describe('Happy Hare', () => {
  test('printers without an MMU keep the existing navigation', async ({ page }) => {
    await openWithMock(page, 'extrude', { scenario: 'ready', homed: true });
    await expect(page.getByRole('link', { name: 'MMU' })).toHaveCount(0);
  });

  test('says Happy Hare is not installed when the route is opened without it', async ({ page }) => {
    await openWithMock(page, 'mmu', { scenario: 'ready', homed: true });
    await expect(page.getByRole('link', { name: 'MMU' })).toHaveCount(0);
    await expect(page.getByText('Happy Hare is not installed on this printer.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change' })).toHaveCount(0);
  });

  test('shows gates, confirms a change, and sends nothing if you go back', async ({ page }) => {
    const mock = await openWithMock(page, 'mmu', { scenario: 'ready', homed: true, mmu: 'ready' });
    await expect(page.getByRole('link', { name: 'MMU' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('Active: Galaxy Orange · ASA')).toBeVisible();
    await expect(page.getByText('blue')).toBeVisible();
    await expect(page.getByText('Buffered')).toBeVisible();

    const change = page.getByRole('listitem').filter({ hasText: 'Gate 0' }).getByRole('button', { name: 'Change' });
    await change.click();
    await expect(page.getByRole('alertdialog')).toContainText('tool 0');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Go back' }).click();
    expect(mock.scripts).toEqual([]);

    await change.click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Change tool' }).click();
    await expect.poll(() => mock.scripts).toContain('MMU_CHANGE_TOOL TOOL=0');
  });

  test('does not move filament while printing', async ({ page }) => {
    const mock = await openWithMock(page, 'mmu', { scenario: 'printing', mmu: 'printing' });
    await expect(page.getByText(/print is active/i)).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Gate 0' }).getByRole('button', { name: 'Change' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Unload' })).toBeDisabled();
    expect(mock.scripts.filter((script) => script.startsWith('MMU_'))).toEqual([]);
  });

  test('offers recover and unlock while pause locked, and no tool change', async ({ page }) => {
    const mock = await openWithMock(page, 'mmu', { scenario: 'ready', homed: true, mmu: 'pause_locked' });
    await expect(page.getByText('Filament encoder not detected')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Gate 0' }).getByRole('button', { name: 'Change' })).toBeDisabled();
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('does not resume');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Go back' }).click();
    expect(mock.scripts).toEqual([]);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Unlock' }).click();
    await expect.poll(() => mock.scripts).toContain('MMU_UNLOCK');
    expect(mock.scripts.some((script) => script.startsWith('MMU_CHANGE_TOOL'))).toBe(false);
  });

  test('waits while Happy Hare is already moving', async ({ page }) => {
    const mock = await openWithMock(page, 'mmu', { scenario: 'ready', homed: true, mmu: 'busy' });
    await expect(page.getByText(/Happy Hare is Loading/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change' }).first()).toBeDisabled();
    expect(mock.scripts).toEqual([]);
  });

  test('hides filament buttons when the documented commands are not registered', async ({ page }) => {
    await openWithMock(page, 'mmu', { scenario: 'ready', homed: true, mmu: 'unsupported' });
    await expect(page.getByText('Gate 0')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Select' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Load' })).toHaveCount(0);
    await expect(page.getByText(/does not register Happy Hare filament commands/)).toBeVisible();
  });

  test('uses the older tool commands when those are the ones registered', async ({ page }) => {
    const mock = await openWithMock(page, 'mmu', { scenario: 'ready', homed: true, mmu: 'legacy' });
    await expect(page.getByRole('button', { name: 'Change' })).toHaveCount(0);
    const select = page.getByRole('listitem').filter({ hasText: 'Gate 0' }).getByRole('button', { name: 'Select' });
    await select.click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Select tool' }).click();
    await expect.poll(() => mock.scripts).toContain('MMU_SELECT_TOOL TOOL=0');
    expect(mock.scripts.some((script) => script.startsWith('MMU_CHANGE_TOOL'))).toBe(false);
  });

  test('drops gate controls when the printer goes offline', async ({ page }) => {
    const mock = await openWithMock(page, 'mmu', { scenario: 'ready', homed: true, mmu: 'ready' });
    await expect(page.getByRole('button', { name: 'Change' }).first()).toBeVisible();
    await mock.disconnect();
    await expect(page.getByText(/unavailable while the printer is offline/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change' })).toHaveCount(0);
  });

  for (const vp of VIEWPORTS) {
    test(`layout ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openWithMock(page, 'mmu', { scenario: 'ready', homed: true, mmu: 'ready' });
      await expect(page.getByRole('heading', { name: 'ERCF' })).toBeVisible();
      await expectCleanLayout(page);
    });
  }
});
