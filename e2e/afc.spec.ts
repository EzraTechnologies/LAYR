import { expect, test } from '@playwright/test';
import { expectCleanLayout, openWithMock, VIEWPORTS } from './helpers';

test.describe('AFC', () => {
  test('printers without AFC keep the existing navigation', async ({ page }) => {
    await openWithMock(page, 'extrude', { scenario: 'ready', homed: true });
    await expect(page.getByRole('link', { name: 'AFC' })).toHaveCount(0);
  });

  test('says AFC is not installed when the route is opened without it', async ({ page }) => {
    await openWithMock(page, 'afc', { scenario: 'ready', homed: true });
    await expect(page.getByRole('link', { name: 'AFC' })).toHaveCount(0);
    await expect(page.getByText('AFC is not installed on this printer.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change' })).toHaveCount(0);
  });

  test('shows lanes, confirms a change, and sends nothing if you go back', async ({ page }) => {
    const mock = await openWithMock(page, 'afc', { scenario: 'ready', homed: true, afc: 'ready' });
    await expect(page.getByRole('link', { name: 'AFC' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('In Tool')).toBeVisible();
    await expect(page.getByText('420.4 g')).toBeVisible();
    await expect(page.getByText('blue')).toBeVisible();
    await expect(page.getByText('Details not reported')).toBeVisible();

    const change = page.getByRole('listitem').filter({ hasText: 'lane1' }).getByRole('button', { name: 'Change' });
    await change.click();
    await expect(page.getByRole('alertdialog')).toContainText('load lane1');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Go back' }).click();
    expect(mock.scripts).toEqual([]);

    await change.click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Change lane' }).click();
    await expect.poll(() => mock.scripts).toContain('CHANGE_TOOL LANE=lane1');
  });

  test('does not move filament while printing', async ({ page }) => {
    const mock = await openWithMock(page, 'afc', { scenario: 'printing', afc: 'ready' });
    await expect(page.getByText(/print is active/i)).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'lane1' }).getByRole('button', { name: 'Change' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Unload' })).toBeDisabled();
    expect(mock.scripts.filter((script) => /CHANGE_TOOL|TOOL_UNLOAD|TOOL_LOAD/.test(script))).toEqual([]);
  });

  test('blocks motion on an AFC error and can still clear the message', async ({ page }) => {
    const mock = await openWithMock(page, 'afc', { scenario: 'ready', homed: true, afc: 'error' });
    await expect(page.getByText('Lane sensor did not trigger')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'lane1' }).getByRole('button', { name: 'Change' })).toBeDisabled();
    await page.getByRole('button', { name: 'Clear message' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Clear message' }).click();
    await expect.poll(() => mock.scripts).toContain('AFC_CLEAR_MESSAGE');
    expect(mock.scripts.some((script) => script.startsWith('CHANGE_TOOL'))).toBe(false);
  });

  test('waits while AFC is already moving', async ({ page }) => {
    const mock = await openWithMock(page, 'afc', { scenario: 'ready', homed: true, afc: 'busy' });
    await expect(page.getByText(/AFC is Loading/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change' }).first()).toBeDisabled();
    expect(mock.scripts).toEqual([]);
  });

  test('hides lane buttons when the documented commands are not registered', async ({ page }) => {
    await openWithMock(page, 'afc', { scenario: 'ready', homed: true, afc: 'unsupported' });
    await expect(page.getByText('lane1')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Load' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Unload' })).toHaveCount(0);
    await expect(page.getByText(/does not register AFC lane commands/)).toBeVisible();
  });

  test('drops lane controls when the printer goes offline', async ({ page }) => {
    const mock = await openWithMock(page, 'afc', { scenario: 'ready', homed: true, afc: 'ready' });
    await expect(page.getByRole('button', { name: 'Change' }).first()).toBeVisible();
    await mock.disconnect();
    await expect(page.getByText(/unavailable while the printer is offline/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change' })).toHaveCount(0);
  });

  for (const vp of VIEWPORTS) {
    test(`layout ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openWithMock(page, 'afc', { scenario: 'ready', homed: true, afc: 'ready' });
      await expect(page.getByRole('heading', { name: 'BoxTurtle' })).toBeVisible();
      await expectCleanLayout(page);
    });
  }
});
