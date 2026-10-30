import { expect, test, type Page } from '@playwright/test';
import { expectCleanLayout, openWithMock, VIEWPORTS } from './helpers';
import { MOONRAKER, type MockMoonraker } from './mockMoonraker';

function reboot(page: Page) {
  return page.getByRole('button', { name: 'Reboot Raspberry Pi', exact: true });
}

function shutdown(page: Page) {
  return page.getByRole('button', { name: 'Shut down Raspberry Pi', exact: true });
}

function hostCalls(mock: MockMoonraker) {
  return mock.calls.filter((call) => call.method.startsWith('machine.'));
}

/** The host card shares the settings scroller, in the left column under Connection. */
async function revealHost(page: Page) {
  await page.getByRole('heading', { name: 'Raspberry Pi' }).scrollIntoViewIfNeeded();
}

async function confirm(page: Page, label: string) {
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: label }).click();
  await expect(dialog).toBeHidden();
}

for (const vp of VIEWPORTS) {
  test.describe(`Raspberry Pi host controls ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('confirms reboot and shutdown, and does not send them on its own', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'ready', homed: true });
      await page.getByRole('heading', { name: 'Klipper' }).scrollIntoViewIfNeeded();
      await expect(page.getByRole('heading', { name: 'Klipper' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Restart Klipper' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Firmware restart' })).toBeVisible();
      await revealHost(page);
      await expect(page.getByRole('heading', { name: 'Raspberry Pi' })).toBeVisible();
      expect(hostCalls(mock)).toEqual([]);
      await expectCleanLayout(page);

      await reboot(page).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog.getByRole('heading', { name: 'Reboot this Raspberry Pi?' })).toBeVisible();
      await expect(dialog).toContainText('Raspberry Pi host trident');
      await expect(dialog).toContainText('not a Klipper firmware restart');
      await expect(dialog).toContainText('lose its connection');
      await expect(dialog).toContainText('printer power supply');
      await expectCleanLayout(page);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      expect(hostCalls(mock)).toEqual([]);

      await reboot(page).focus();
      await page.keyboard.press('Enter');
      await expect(dialog.getByRole('button', { name: 'Go back' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeHidden();
      expect(hostCalls(mock)).toEqual([]);

      await reboot(page).click();
      await confirm(page, 'Reboot Raspberry Pi');
      await expect(page.getByText('does not mean the Raspberry Pi has finished restarting')).toBeVisible();
      expect(hostCalls(mock)).toEqual([{ method: 'machine.reboot', params: undefined }]);

      await shutdown(page).click();
      await expect(dialog.getByRole('heading', { name: 'Shut down this Raspberry Pi?' })).toBeVisible();
      await expect(dialog).toContainText('does not necessarily remove power');
      await expect(dialog).toContainText('physical power cycle');
      await confirm(page, 'Shut down Raspberry Pi');
      await expect(page.getByText('does not mean power was removed')).toBeVisible();
      expect(hostCalls(mock)).toEqual([
        { method: 'machine.reboot', params: undefined },
        { method: 'machine.shutdown', params: undefined },
      ]);
      expect(mock.calls.some((call) => call.method.startsWith('machine.') && !['machine.reboot', 'machine.shutdown'].includes(call.method))).toBe(
        false,
      );
      expect(page.url()).toContain(encodeURIComponent(MOONRAKER));
    });

    test('disables both controls while printing', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'printing', homed: true });
      await revealHost(page);
      await expect(reboot(page)).toBeDisabled();
      await expect(shutdown(page)).toBeDisabled();
      await expect(page.getByText('Not available during a print')).toBeVisible();
      await expectCleanLayout(page);
      expect(hostCalls(mock)).toEqual([]);
    });

    test('disables both controls while paused', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'paused', homed: true });
      await revealHost(page);
      await expect(reboot(page)).toBeDisabled();
      await expect(shutdown(page)).toBeDisabled();
      await expect(page.getByText('Not available while a print is paused')).toBeVisible();
      expect(hostCalls(mock)).toEqual([]);
    });

    test('disables both controls when the print state is unknown', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', {
        scenario: 'ready',
        status: { print_stats: { state: 'not-a-state', filename: '' } },
      });
      await revealHost(page);
      await expect(reboot(page)).toBeDisabled();
      await expect(shutdown(page)).toBeDisabled();
      await expect(page.getByText('Print state is unknown')).toBeVisible();
      expect(hostCalls(mock)).toEqual([]);
    });

    test('disables both controls when Klipper is not ready', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'shutdown' });
      await revealHost(page);
      await expect(reboot(page)).toBeDisabled();
      await expect(shutdown(page)).toBeDisabled();
      await expect(page.getByText('Klipper is not ready')).toBeVisible();
      expect(hostCalls(mock)).toEqual([]);
    });

    test('disables both controls when Moonraker has not reported the machine component', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'ready', omitComponents: true });
      await revealHost(page);
      await expect(reboot(page)).toBeDisabled();
      await expect(page.getByText('Moonraker has not reported Raspberry Pi host controls')).toBeVisible();
      expect(hostCalls(mock)).toEqual([]);
    });

    test('disables both controls when the machine component is unavailable', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'ready', host: 'failed' });
      await revealHost(page);
      await expect(shutdown(page)).toBeDisabled();
      await expect(page.getByText('does not provide Raspberry Pi reboot or shutdown')).toBeVisible();
      expect(hostCalls(mock)).toEqual([]);
    });

    test('keeps both controls off while offline or not set up', async ({ page }) => {
      await page.goto('/?moonraker=http://127.0.0.1:9#/settings');
      await revealHost(page);
      await expect(page.getByText('Printer is offline')).toBeVisible({ timeout: 10_000 });
      await expect(reboot(page)).toBeDisabled();
      await expect(shutdown(page)).toBeDisabled();
      await expectCleanLayout(page);

      await page.goto('/#/settings');
      await revealHost(page);
      await expect(reboot(page)).toBeDisabled();
      await expect(shutdown(page)).toBeDisabled();
      await expect(page.getByText('Set up the printer connection in Settings')).toBeVisible();
    });

    test('reports a denied host command without treating it as success', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'ready', homed: true, host: 'denied' });
      await shutdown(page).click();
      await confirm(page, 'Shut down Raspberry Pi');
      await expect(page.locator('#pi-block')).toHaveText('Moonraker denied Raspberry Pi host control for this connection');
      await expect(page.getByRole('button', { name: 'Shut down Raspberry Pi failed' })).toBeVisible();
      await expect(page.getByText('Moonraker accepted the request')).toHaveCount(0);
      await expect(shutdown(page)).toBeDisabled();
      await expect(reboot(page)).toBeDisabled();
      expect(hostCalls(mock)).toEqual([{ method: 'machine.shutdown', params: undefined }]);
    });

    test('reports a missing host method without treating it as success', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'ready', homed: true, host: 'missing' });
      await reboot(page).click();
      await confirm(page, 'Reboot Raspberry Pi');
      await expect(page.locator('#pi-block')).toHaveText('This Moonraker does not provide Raspberry Pi reboot or shutdown');
      await expect(page.getByRole('button', { name: 'Reboot Raspberry Pi failed' })).toBeVisible();
      await expect(page.getByText('Moonraker accepted the request')).toHaveCount(0);
      await expect(reboot(page)).toBeDisabled();
      expect(hostCalls(mock)).toEqual([{ method: 'machine.reboot', params: undefined }]);
    });

    test('does not treat a dropped connection as a finished reboot', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'ready', homed: true, host: 'drop' });
      await reboot(page).click();
      await confirm(page, 'Reboot Raspberry Pi');
      await expect(page.getByText('result unknown')).toBeVisible();
      await expect(page.getByText('may still be running')).toBeVisible();
      await expect(page.getByText('Moonraker accepted the request')).toHaveCount(0);
      expect(hostCalls(mock).map((call) => call.method)).toEqual(['machine.reboot']);
    });

    test('ignores a second tap while the host request is in flight', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'ready', homed: true, hostDelayMs: 1200 });
      await reboot(page).click();
      await confirm(page, 'Reboot Raspberry Pi');
      await expect(reboot(page)).toHaveAttribute('aria-busy', 'true');
      await expect(shutdown(page)).toHaveAttribute('aria-busy', 'true');
      await shutdown(page).evaluate((button: HTMLButtonElement) => button.click());
      await expect(page.getByText('Still waiting for the previous command')).toBeVisible();
      expect(hostCalls(mock)).toEqual([{ method: 'machine.reboot', params: undefined }]);
      await expect(page.getByText('does not mean the Raspberry Pi has finished restarting')).toBeVisible();
      expect(hostCalls(mock)).toEqual([{ method: 'machine.reboot', params: undefined }]);
    });
  });
}
