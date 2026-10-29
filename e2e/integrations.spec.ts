import { expect, test, type Page } from '@playwright/test';
import { ROUTES } from '../src/lib/routes';
import { expectCleanLayout, openWithMock, VIEWPORTS } from './helpers';
import { MOONRAKER, type MockMoonraker } from './mockMoonraker';

/** Reads and writes that must not run just because a switch moved. */
const MOTION_METHODS = [
  'printer.gcode.script',
  'printer.gcode.help',
  'printer.print.start',
  'printer.print.pause',
  'printer.print.resume',
  'printer.print.cancel',
  'printer.emergency_stop',
  'printer.restart',
  'printer.firmware_restart',
  'server.files.delete_file',
  'server.spoolman.proxy',
  'server.spoolman.status',
  'server.spoolman.get_spool_id',
  'server.spoolman.post_spool_id',
];

function row(page: Page, id: string) {
  return page.locator('.integration', { has: page.locator(`[data-integration="${id}"]`) });
}

function switchFor(page: Page, id: string) {
  return row(page, id).getByRole('switch');
}

async function expectNoMotion(mock: MockMoonraker) {
  const methods = mock.calls.map((call) => call.method);
  for (const method of MOTION_METHODS) expect(methods).not.toContain(method);
  expect(mock.scripts).toEqual([]);
  expect(mock.controlCalls).toEqual([]);
}

for (const vp of VIEWPORTS) {
  test.describe(`integration switches ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('defaults off, keeps the other settings, and sends nothing to the printer', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'ready', homed: true });
      await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
      for (const id of ['spoolman', 'happyHare', 'afc']) {
        await expect(switchFor(page, id)).toHaveAttribute('aria-checked', 'false');
        await expect(row(page, id).locator('.integration-status')).toHaveText('Off');
      }
      await expect(page.getByText('Happy Hare and AFC are both off.')).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveCount(ROUTES.length);
      await expect(page.getByRole('link', { name: 'MMU', exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'AFC', exact: true })).toHaveCount(0);

      const listed = mock.calls.filter((call) => call.method === 'printer.objects.list').length;
      await page.waitForTimeout(400);
      expect(mock.calls.filter((call) => call.method === 'printer.objects.list')).toHaveLength(listed);

      await page.getByRole('radio', { name: 'True black' }).click();
      await page.getByRole('radio', { name: 'Thumbnails' }).click();
      await expect(page.getByRole('switch', { name: 'Touch keyboard' })).toHaveAttribute('aria-checked', 'true');
      await switchFor(page, 'spoolman').click();
      await expect(switchFor(page, 'spoolman')).toHaveAttribute('aria-checked', 'true');
      await expect(switchFor(page, 'happyHare')).toHaveAttribute('aria-checked', 'false');
      await expect(switchFor(page, 'afc')).toHaveAttribute('aria-checked', 'false');

      await page.reload();
      await expect(page.getByRole('radio', { name: 'True black' })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByRole('radio', { name: 'Thumbnails' })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByRole('switch', { name: 'Touch keyboard' })).toHaveAttribute('aria-checked', 'true');
      await expect(switchFor(page, 'spoolman')).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByRole('switch', { name: 'Hide pointer' })).toHaveAttribute('aria-checked', 'false');

      await page.getByRole('button', { name: 'Moonraker URL' }).click();
      await expect(page.getByRole('group', { name: 'On-screen keyboard' })).toBeVisible();
      await expectCleanLayout(page);
      await page.getByRole('button', { name: 'Close' }).click();
      await expectNoMotion(mock);
    });

    test('Happy Hare and AFC exclude each other, and both can be off', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'ready', homed: true });
      await switchFor(page, 'spoolman').click();
      await switchFor(page, 'happyHare').click();
      await expect(switchFor(page, 'happyHare')).toHaveAttribute('aria-checked', 'true');
      await expect(switchFor(page, 'afc')).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByText('Happy Hare is on, so AFC is off.')).toBeVisible();

      await switchFor(page, 'afc').click();
      await expect(switchFor(page, 'afc')).toHaveAttribute('aria-checked', 'true');
      await expect(switchFor(page, 'happyHare')).toHaveAttribute('aria-checked', 'false');
      await expect(switchFor(page, 'spoolman')).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByText('AFC is on, so Happy Hare is off.')).toBeVisible();

      await switchFor(page, 'happyHare').click();
      await expect(switchFor(page, 'happyHare')).toHaveAttribute('aria-checked', 'true');
      await expect(switchFor(page, 'afc')).toHaveAttribute('aria-checked', 'false');

      await switchFor(page, 'happyHare').click();
      await expect(switchFor(page, 'happyHare')).toHaveAttribute('aria-checked', 'false');
      await expect(switchFor(page, 'afc')).toHaveAttribute('aria-checked', 'false');
      await expect(switchFor(page, 'spoolman')).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByText('Happy Hare and AFC are both off.')).toBeVisible();

      await switchFor(page, 'afc').click();
      await switchFor(page, 'afc').click();
      await expect(switchFor(page, 'afc')).toHaveAttribute('aria-checked', 'false');
      await expect(switchFor(page, 'happyHare')).toHaveAttribute('aria-checked', 'false');
      await expectCleanLayout(page);
      await expectNoMotion(mock);
    });

    test('a second printer address does not inherit the switches', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'ready', homed: true });
      await switchFor(page, 'spoolman').click();
      await switchFor(page, 'happyHare').click();
      await expect(switchFor(page, 'happyHare')).toHaveAttribute('aria-checked', 'true');

      await page.goto(`/?moonraker=${encodeURIComponent('http://127.0.0.1:9')}#/settings`);
      await expect(switchFor(page, 'spoolman')).toHaveAttribute('aria-checked', 'false');
      await expect(switchFor(page, 'happyHare')).toHaveAttribute('aria-checked', 'false');
      await expect(switchFor(page, 'afc')).toHaveAttribute('aria-checked', 'false');
      await switchFor(page, 'afc').click();
      await expect(row(page, 'afc').locator('.integration-status')).toHaveText('On, waiting for the printer');
      await expect(switchFor(page, 'spoolman')).toHaveAttribute('aria-checked', 'false');

      await page.goto(`/?moonraker=${encodeURIComponent(MOONRAKER)}#/settings`);
      await expect(page.getByRole('status', { name: /Printer status/ })).not.toHaveText(/Connecting|Offline|Not set up/, { timeout: 10_000 });
      await expect(switchFor(page, 'spoolman')).toHaveAttribute('aria-checked', 'true');
      await expect(switchFor(page, 'happyHare')).toHaveAttribute('aria-checked', 'true');
      await expect(switchFor(page, 'afc')).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
      await expectNoMotion(mock);
      await expectCleanLayout(page);
    });

    test('enabled features stay hidden when the printer does not report them', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'ready', homed: true });
      await switchFor(page, 'spoolman').click();
      await switchFor(page, 'happyHare').click();
      await expect(row(page, 'happyHare').locator('.integration-status')).toHaveText('On, not detected on this printer');
      await expect(row(page, 'spoolman').locator('.integration-status')).toHaveText('On, not detected on this printer');
      await switchFor(page, 'afc').click();
      await expect(row(page, 'happyHare').locator('.integration-status')).toHaveText('Off');
      await expect(row(page, 'afc').locator('.integration-status')).toHaveText('On, not detected on this printer');
      await expect(page.getByRole('link', { name: 'MMU', exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'AFC', exact: true })).toHaveCount(0);
      await page.getByRole('link', { name: 'Extrude' }).click();
      await expect(page.getByRole('heading', { name: /Extruder/ })).toBeVisible();
      await expect(page.getByText('Spool tracking with Spoolman is planned for a later release.')).toBeVisible();
      await expect(page.getByRole('button', { name: /spool/i })).toHaveCount(0);
      await expectNoMotion(mock);
      await expectCleanLayout(page);
    });

    test('toggling during a print does not pause or move the printer', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'printing', homed: true });
      await expect(page.getByText('A print is active.')).toBeVisible();
      await switchFor(page, 'spoolman').click();
      await switchFor(page, 'happyHare').click();
      await switchFor(page, 'afc').click();
      await switchFor(page, 'happyHare').click();
      await switchFor(page, 'happyHare').click();
      await expect(page.getByRole('status', { name: /Printer status/ })).toHaveText(/Printing/);
      await expectNoMotion(mock);
      await expectCleanLayout(page);
    });
  });
}
