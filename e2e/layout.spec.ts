import { expect, test } from '@playwright/test';
import { ROUTES } from '../src/lib/routes';
import { expectCleanLayout, openWithMock, VIEWPORTS } from './helpers';
import type { Scenario } from './mockMoonraker';

const DASHBOARD_SCENARIOS: Scenario[] = ['ready', 'printing', 'paused', 'complete', 'shutdown'];

for (const vp of VIEWPORTS) {
  test.describe(`layout ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const scenario of DASHBOARD_SCENARIOS) {
      test(`dashboard: ${scenario}`, async ({ page }) => {
        await openWithMock(page, 'home', { scenario, homed: true });
        await expectCleanLayout(page);
      });
    }

    for (const route of ROUTES.map((r) => r.id).filter((r) => r !== 'home')) {
      for (const scenario of ['ready', 'printing'] as const) {
        test(`route: ${route} (${scenario})`, async ({ page }) => {
          await openWithMock(page, route, { scenario, homed: true });
          await expect(page.getByRole('link', { name: new RegExp(`^${route}`, 'i') })).toHaveAttribute('aria-current', 'page');
          await page.waitForTimeout(300);
          await expectCleanLayout(page);
        });
      }
    }

    test('not set up (no endpoint configured)', async ({ page }) => {
      await page.goto('/#/home');
      await expect(page.getByRole('heading', { name: 'Connect LAYR to your printer' })).toBeVisible();
      await expectCleanLayout(page);
    });

    test('offline (Moonraker unreachable)', async ({ page }) => {
      await page.goto('/?moonraker=http://127.0.0.1:9#/home');
      await expect(page.getByRole('heading', { name: 'Printer is offline' })).toBeVisible({ timeout: 10_000 });
      await expectCleanLayout(page);
    });

    test('dialogs: confirmation, keypad and keyboard', async ({ page }) => {
      await openWithMock(page, 'heat', { scenario: 'ready' });
      await page.getByRole('button', { name: 'Set Nozzle target' }).click();
      await expect(page.getByRole('dialog', { name: 'Nozzle target' })).toBeVisible();
      await expectCleanLayout(page);
      await page.getByRole('button', { name: 'Close' }).click();

      await page.getByRole('link', { name: 'Console' }).click();
      await page.getByRole('button', { name: 'Edit command' }).click();
      await expect(page.getByRole('group', { name: 'On-screen keyboard' })).toBeVisible();
      await expectCleanLayout(page);
    });
  });
}
