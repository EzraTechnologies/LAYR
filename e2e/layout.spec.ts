import { expect, test } from '@playwright/test';
import { DEMO_SCENARIOS } from '../src/lib/demo/scenarios';
import { expectCleanLayout, VIEWPORTS } from './helpers';

const ROUTES = ['home', 'files', 'controls', 'filament', 'settings'] as const;

for (const vp of VIEWPORTS) {
  test.describe(`layout ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const scenario of DEMO_SCENARIOS) {
      test(`dashboard: ${scenario}`, async ({ page }) => {
        await page.goto(`/?demo=${scenario}#/home`);
        await expect(page.getByText('Demo', { exact: true })).toBeVisible();
        await expectCleanLayout(page);
      });
    }

    for (const route of ROUTES.slice(1)) {
      test(`route: ${route}`, async ({ page }) => {
        await page.goto(`/?demo=printing#/${route}`);
        await expect(page.getByRole('link', { name: new RegExp(route, 'i') })).toHaveAttribute('aria-current', 'page');
        await expectCleanLayout(page);
      });
    }
  });
}

test.describe('screenshots @screenshot', () => {
  const shots: Array<{ scenario: string; route: string }> = [
    { scenario: 'printing', route: 'home' },
    { scenario: 'paused', route: 'home' },
    { scenario: 'ready', route: 'home' },
    { scenario: 'error', route: 'home' },
    { scenario: 'disconnected', route: 'home' },
    { scenario: 'printing', route: 'settings' },
    { scenario: 'printing', route: 'filament' },
  ];

  for (const vp of VIEWPORTS) {
    for (const shot of shots) {
      test(`${vp.name} ${shot.route} ${shot.scenario}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`/?demo=${shot.scenario}#/${shot.route}`);
        await page.evaluate(() => document.fonts.ready);
        // Let the one-off progress transition settle so captures are stable.
        await page.waitForTimeout(700);
        const name = shot.route === 'home' ? shot.scenario : shot.route;
        await page.screenshot({ path: `docs/screenshots/${vp.name}-${name}.png` });
      });
    }
  }
});
