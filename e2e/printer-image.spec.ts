import { expect, test } from '@playwright/test';
import { integrationScopeKey } from '../src/lib/integrations/preferences';
import { LIMITS } from '../src/lib/printerImage/policy';
import { expectCleanLayout, openWithMock, VIEWPORTS } from './helpers';
import { MockMoonraker, MOONRAKER } from './mockMoonraker';
import { choosePrinterPhoto, PRINTER_SCOPE, storedPrinterPhoto } from './printerImage';

const FILE_THUMB = 'SB_main_body_ASA_0.2mm_3h41m';

async function savePhoto(page: import('@playwright/test').Page) {
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await choosePrinterPhoto(page);
}

for (const vp of VIEWPORTS) {
  test.describe(`printer image ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('idle shows the photo with Ready to print and Browse files', async ({ page }) => {
      const mock = await openWithMock(page, 'home', { scenario: 'ready', homed: true });
      const placeholder = await page.getByRole('img', { name: 'Generic printer placeholder' }).boundingBox();
      expect(placeholder?.height ?? 0).toBeGreaterThan(120);
      await expect(page.getByRole('heading', { name: 'Ready to print' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Browse files' })).toBeVisible();
      await expectCleanLayout(page);

      await savePhoto(page);
      await page.getByRole('link', { name: 'Home', exact: true }).click();
      const photo = page.getByRole('img', { name: 'Printer photo' });
      await expect(photo).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Ready to print' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Browse files' })).toBeVisible();
      expect((await photo.boundingBox())?.height ?? 0).toBeGreaterThan(120);
      await expectCleanLayout(page);
      expect(mock.controlCalls).toEqual([]);
    });

    test('a finished job shows the printer photo instead of the old file thumbnail', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'complete' });
      await choosePrinterPhoto(page);
      await page.getByRole('link', { name: 'Home', exact: true }).click();
      await expect(page.getByText('Print complete')).toBeVisible();
      await expect(page.getByRole('heading', { name: FILE_THUMB })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Files' })).toBeVisible();
      await expect(page.getByRole('img', { name: 'Printer photo' })).toBeVisible();
      await expect(page.getByRole('img', { name: FILE_THUMB })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Ready to print' })).toHaveCount(0);
      await expectCleanLayout(page);
      expect(mock.controlCalls).toEqual([]);
    });

    test('printing keeps the file thumbnail, progress, and controls', async ({ page }) => {
      const printing = await openWithMock(page, 'settings', { scenario: 'printing' });
      await choosePrinterPhoto(page);
      await page.getByRole('link', { name: 'Home', exact: true }).click();
      await expect(page.getByRole('img', { name: FILE_THUMB })).toBeVisible();
      await expect(page.getByRole('img', { name: 'Printer photo' })).toHaveCount(0);
      await expect(page.getByRole('progressbar')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
      await expectCleanLayout(page);
      expect(printing.controlCalls).toEqual([]);
    });

    test('paused keeps the file thumbnail and the resume control', async ({ page }) => {
      await openWithMock(page, 'settings', { scenario: 'paused' });
      await choosePrinterPhoto(page);
      await page.getByRole('link', { name: 'Home', exact: true }).click();
      await expect(page.getByRole('img', { name: FILE_THUMB })).toBeVisible();
      await expect(page.getByRole('img', { name: 'Printer photo' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
      await expectCleanLayout(page);
    });

    test('a print with no file thumbnail falls back to the printer photo, then the generic mark', async ({ page }) => {
      const options = {
        scenario: 'printing' as const,
        status: {
          print_stats: {
            filename: 'no_preview_bracket.gcode',
            state: 'printing',
            message: '',
            print_duration: 10,
            total_duration: 12,
            filament_used: 10,
            info: { current_layer: 1, total_layer: 4 },
          },
        },
      };
      await openWithMock(page, 'home', options);
      await expect(page.getByRole('img', { name: 'no_preview_bracket (no preview)' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

      await savePhoto(page);
      await page.getByRole('link', { name: 'Home', exact: true }).click();
      await expect(page.getByRole('img', { name: 'Printer photo' })).toBeVisible();
      await expect(page.getByRole('img', { name: 'no_preview_bracket (no preview)' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'no_preview_bracket' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
      await expectCleanLayout(page);
    });

    test('offline and a Klipper shutdown do not look ready or printing', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'ready', homed: true });
      await choosePrinterPhoto(page);
      await page.getByRole('link', { name: 'Home', exact: true }).click();
      await expect(page.getByRole('img', { name: 'Printer photo' })).toBeVisible();
      await mock.disconnect();
      await expect(page.getByRole('heading', { name: 'Printer is offline' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Ready to print' })).toHaveCount(0);
      await expect(page.getByRole('img', { name: 'Printer photo' })).toHaveCount(0);
      await expectCleanLayout(page);

      const shutdown = await page.context().newPage();
      await new MockMoonraker({ scenario: 'shutdown' }).install(shutdown);
      await shutdown.setViewportSize({ width: vp.width, height: vp.height });
      await shutdown.goto(`/?moonraker=${encodeURIComponent(MOONRAKER)}#/home`);
      await expect(shutdown.getByRole('heading', { name: 'Printer reports an error' })).toBeVisible();
      await expect(shutdown.getByRole('heading', { name: 'Ready to print' })).toHaveCount(0);
      await expect(shutdown.getByRole('img', { name: 'Printer photo' })).toHaveCount(0);
      await expectCleanLayout(shutdown);
      await shutdown.close();
    });
  });
}

test.describe('printer image storage', () => {
  test.use({ viewport: { width: 1024, height: 600 } });

  test('persists a bounded jpeg for this printer and hides it from another address', async ({ page }) => {
    const mock = await openWithMock(page, 'settings', { scenario: 'ready', homed: true });
    await expect(page.getByText(/Chromium restart/)).toBeVisible();
    await expect(page.getByText(/not sent to the printer/)).toBeVisible();
    await choosePrinterPhoto(page);
    const stored = await storedPrinterPhoto(page);
    expect(stored).not.toBeNull();
    expect(stored?.mime).toBe('image/jpeg');
    expect(stored?.size ?? 0).toBeGreaterThan(0);
    expect(stored?.size ?? 0).toBeLessThanOrEqual(LIMITS.maxStoredBytes);
    expect(stored?.width ?? 0).toBeLessThanOrEqual(LIMITS.maxEdge);
    expect(stored?.height ?? 0).toBeLessThanOrEqual(LIMITS.maxEdge);
    expect(mock.controlCalls).toEqual([]);

    await page.reload();
    await expect(page.getByRole('img', { name: 'Printer photo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove photo' })).toBeVisible();

    const reopened = await page.context().newPage();
    await mock.install(reopened);
    await reopened.goto(`/?moonraker=${encodeURIComponent(MOONRAKER)}#/home`);
    await expect(reopened.getByRole('heading', { name: 'Ready to print' })).toBeVisible();
    await expect(reopened.getByRole('img', { name: 'Printer photo' })).toBeVisible();
    await expect(reopened.getByRole('button', { name: 'Browse files' })).toBeVisible();
    await reopened.close();

    await page.goto(`/?moonraker=${encodeURIComponent('http://other.local:7125')}#/settings`);
    await expect(page.getByRole('img', { name: 'Generic printer placeholder' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Printer photo' })).toHaveCount(0);
    expect(await storedPrinterPhoto(page, integrationScopeKey('default', 'http://other.local:7125'))).toBeNull();
    expect(await storedPrinterPhoto(page, PRINTER_SCOPE)).not.toBeNull();

    await page.goto(`/?moonraker=${encodeURIComponent(MOONRAKER)}#/home`);
    await expect(page.getByRole('img', { name: 'Printer photo' })).toBeVisible();
  });

  test('rejects an empty, non-image, oversized, or unreadable file and keeps the saved photo', async ({ page }) => {
    await openWithMock(page, 'settings', { scenario: 'ready', homed: true });
    await choosePrinterPhoto(page);
    const before = await storedPrinterPhoto(page);

    await page.locator('#printer-image-file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByRole('alert')).toContainText('JPEG, PNG, WebP, or GIF');

    await page.locator('#printer-image-file').setInputFiles({
      name: 'mark.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    });
    await expect(page.getByRole('alert')).toContainText('JPEG, PNG, WebP, or GIF');

    await page.locator('#printer-image-file').setInputFiles({
      name: 'huge.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.alloc(LIMITS.maxInputBytes + 1, 7),
    });
    await expect(page.getByRole('alert')).toContainText('MB or smaller');

    await page.locator('#printer-image-file').setInputFiles({
      name: 'broken.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not a png'),
    });
    await expect(page.getByRole('alert')).toContainText('could not read');

    await expect(page.getByRole('img', { name: 'Printer photo' })).toBeVisible();
    expect(await storedPrinterPhoto(page)).toEqual(before);
  });

  test('drops an unusable saved photo and can remove a good one', async ({ page }) => {
    await openWithMock(page, 'settings', { scenario: 'ready', homed: true });
    await page.evaluate(
      async ({ scopeKey }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('layr.printer-image', 1);
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains('images')) request.result.createObjectStore('images', { keyPath: 'scopeKey' });
          };
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('images', 'readwrite');
          tx.objectStore('images').put({
            scopeKey,
            blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }),
            mime: 'image/jpeg',
            width: 8,
            height: 8,
            savedAt: 1,
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      },
      { scopeKey: PRINTER_SCOPE },
    );
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('could not be used');
    await expect(page.getByRole('img', { name: 'Generic printer placeholder' })).toBeVisible();
    expect(await storedPrinterPhoto(page)).toBeNull();

    await choosePrinterPhoto(page);
    await page.getByRole('button', { name: 'Remove photo' }).click();
    await expect(page.getByRole('img', { name: 'Generic printer placeholder' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Printer photo' })).toHaveCount(0);
    expect(await storedPrinterPhoto(page)).toBeNull();
    await page.reload();
    await expect(page.getByRole('img', { name: 'Printer photo' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Choose photo' })).toBeEnabled();
  });

  test('a printer that is still starting does not show the saved photo as ready', async ({ page }) => {
    await openWithMock(page, 'settings', { scenario: 'ready', homed: true });
    await choosePrinterPhoto(page);
    const starting = await page.context().newPage();
    await new MockMoonraker({ scenario: 'startup' }).install(starting);
    await starting.goto(`/?moonraker=${encodeURIComponent(MOONRAKER)}#/home`);
    await expect(starting.getByRole('heading', { name: 'Connecting to printer' })).toBeVisible();
    await expect(starting.getByRole('heading', { name: 'Ready to print' })).toHaveCount(0);
    await expect(starting.getByRole('img', { name: 'Printer photo' })).toHaveCount(0);
    await starting.close();
  });

  test('a cancelled job does not keep the file thumbnail', async ({ page }) => {
    await openWithMock(page, 'settings', {
      scenario: 'ready',
      status: {
        print_stats: {
          filename: 'stealthburner/SB_main_body_ASA_0.2mm_3h41m.gcode',
          state: 'cancelled',
          message: '',
        },
      },
    });
    await choosePrinterPhoto(page);
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page.getByText('Print cancelled')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Printer photo' })).toBeVisible();
    await expect(page.getByRole('img', { name: FILE_THUMB })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Ready to print' })).toHaveCount(0);
  });

  test('a failed job keeps the error and does not keep the file thumbnail', async ({ page }) => {
    await openWithMock(page, 'settings', {
      scenario: 'ready',
      status: {
        print_stats: {
          filename: 'stealthburner/SB_main_body_ASA_0.2mm_3h41m.gcode',
          state: 'error',
          message: 'Shutdown due to a heater error',
        },
      },
    });
    await choosePrinterPhoto(page);
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page.getByText('Shutdown due to a heater error')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Printer photo' })).toBeVisible();
    await expect(page.getByRole('img', { name: FILE_THUMB })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Ready to print' })).toHaveCount(0);
  });
});
