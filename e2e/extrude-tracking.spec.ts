import { expect, test } from '@playwright/test';
import { expectCleanLayout, openWithMock, VIEWPORTS } from './helpers';

for (const vp of VIEWPORTS) {
  for (const mode of ['disabled', 'absent', 'offline', 'unauthorized'] as const) {
    test(`Extrude ${mode} tracking message ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const mock = await openWithMock(page, 'extrude', {
        scenario: 'ready', spoolman: mode === 'disabled' ? 'ready' : mode,
        seedSwitches: { spoolman: mode !== 'disabled' },
      });
      if (mode === 'disabled') await expect(page.getByText('Spool tracking is disabled. Turn on Spoolman in Settings to use it.')).toBeVisible();
      else if (mode === 'absent') await expect(page.getByText('Spoolman is not configured in Moonraker for this printer. Printing does not require tracking.')).toBeVisible();
      else await expect(page.getByRole('button', { name: mode === 'offline' ? /Spoolman offline/ : /Spoolman unauthorized/ })).toBeVisible();
      await expect(page.getByText(/planned for a later release/)).toHaveCount(0);
      await expectCleanLayout(page);
      expect(mock.controlCalls).toEqual([]);
    });
  }
}
