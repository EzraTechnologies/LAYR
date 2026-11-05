import { expect, test, type Page } from '@playwright/test';
import { integrationScopeKey } from '../src/lib/integrations/preferences';
import { LIMITS } from '../src/lib/printerImage/policy';
import { expectCleanLayout, openWithMock, VIEWPORTS } from './helpers';
import { encodePng } from './png';
import { MockMoonraker, MOONRAKER } from './mockMoonraker';
import { choosePrinterPhoto, PRINTER_SCOPE, storedPrinterPhoto } from './printerImage';

const FILE_THUMB = 'SB_main_body_ASA_0.2mm_3h41m';

async function savePhoto(page: import('@playwright/test').Page) {
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await choosePrinterPhoto(page);
}

async function expectOriginalIdle(page: Page) {
  const card = page.locator('.job');
  await expect(card.getByRole('heading', { name: 'Ready to print' })).toBeVisible();
  await expect(card.getByText('No job is loaded. Choose a file to start a print.', { exact: true })).toBeVisible();
  await expect(card.getByRole('img')).toHaveCount(0);
  const geometry = await card.evaluate(el => {
    const rect = (selector: string) => el.querySelector(selector)!.getBoundingClientRect();
    const idle = rect('.idle');
    const icon = rect('.idle-icon');
    const heading = rect('h2');
    const text = rect('.idle p');
    const button = rect('.idle button');
    return {
      width: icon.width, height: icon.height,
      centers: [icon, heading, text, button].map(r => r.x + r.width / 2 - (idle.x + idle.width / 2)),
      verticalCenter: (icon.top + button.bottom) / 2 - (idle.top + idle.height / 2),
      ordered: icon.bottom <= heading.top && heading.bottom <= text.top && text.bottom <= button.top,
    };
  });
  expect(geometry.width).toBe(72);
  expect(geometry.height).toBe(72);
  expect(geometry.ordered).toBe(true);
  for (const offset of geometry.centers) expect(Math.abs(offset)).toBeLessThan(1);
  expect(Math.abs(geometry.verticalCenter)).toBeLessThan(1);
  await expectCleanLayout(page);
}

for (const vp of VIEWPORTS) {
  test.describe(`printer image ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('idle shows the photo with Ready to print and Browse files', async ({ page }) => {
      const mock = await openWithMock(page, 'home', { scenario: 'ready', homed: true });
      await expectOriginalIdle(page);
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

    test('no photo restores the original idle layout and Browse files navigation', async ({ page }) => {
      const mock = await openWithMock(page, 'home', { scenario: 'ready', homed: true });
      await expectOriginalIdle(page);
      await page.getByRole('button', { name: 'Browse files' }).click();
      await expect(page).toHaveURL(/#\/files$/);
      expect(mock.controlCalls).toEqual([]);
    });

    test('removing a photo restores the original idle layout after reload', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'ready', homed: true });
      await choosePrinterPhoto(page);
      await page.getByRole('button', { name: 'Remove photo' }).click();
      await expect(page.getByRole('button', { name: 'Remove photo' })).toHaveCount(0);
      expect(await storedPrinterPhoto(page)).toBeNull();
      await page.getByRole('link', { name: 'Home', exact: true }).click();
      await expectOriginalIdle(page);
      await page.reload();
      await expectOriginalIdle(page);
      expect(mock.controlCalls).toEqual([]);
    });

    test('a failed photo load falls back to original idle and a replacement photo recovers', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'ready', homed: true });
      await choosePrinterPhoto(page);
      // Revoke the actual blob URL before Home mounts: exercise the native image error event.
      await page.getByRole('img', { name: 'Printer photo' }).evaluate(img => URL.revokeObjectURL((img as HTMLImageElement).src));
      await page.getByRole('link', { name: 'Home', exact: true }).click();
      await expectOriginalIdle(page);
      expect(await storedPrinterPhoto(page)).not.toBeNull();
      await savePhoto(page);
      await page.getByRole('link', { name: 'Home', exact: true }).click();
      await expect(page.getByRole('img', { name: 'Printer photo' })).toBeVisible();
      await expectCleanLayout(page);
      expect(mock.controlCalls).toEqual([]);
    });

    for (const shape of [
      { name: 'portrait', width: 300, height: 900 },
      { name: 'square', width: 800, height: 800 },
      { name: 'large portrait', width: 1200, height: 2400 },
      { name: 'landscape', width: 900, height: 600 },
      { name: 'panoramic', width: 2400, height: 300 },
    ]) {
      test(`${shape.name} photo fits the idle container without cropping or distortion`, async ({ page }) => {
        const mock = await openWithMock(page, 'settings', { scenario: 'ready', homed: true });
        await page.locator('#printer-image-file').setInputFiles({
          name: `${shape.name}.png`, mimeType: 'image/png',
          buffer: encodePng(shape.width, shape.height, () => [62, 224, 240, 255]),
        });
        await expect(page.getByRole('img', { name: 'Printer photo' })).toBeVisible();
        const saved = await storedPrinterPhoto(page);
        expect(saved).not.toBeNull();
        expect(saved!.width / saved!.height).toBeCloseTo(shape.width / shape.height, 1);
        // Settings still uses its full-size preview; only idle Home opts into the inset.
        const settingsFit = await page.getByRole('img', { name: 'Printer photo' }).evaluate(img => img.getBoundingClientRect().width / img.parentElement!.getBoundingClientRect().width);
        expect(settingsFit).toBeGreaterThan(0.9);
        await page.getByRole('link', { name: 'Home', exact: true }).click();
        const photo = page.getByRole('img', { name: 'Printer photo' });
        await expect(photo).toBeVisible();
        await expect.poll(() => photo.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        // Navigation to Home and the image blob becoming visible do not guarantee that
        // the destination route's scoped CSS has been applied. Wait for the final
        // styles and geometry before taking the one-shot measurements below.
        // A real styling regression still fails after the bounded Playwright wait.
        await expect(photo).toHaveCSS('object-fit', 'contain');
        await expect(photo).toHaveCSS('object-position', '50% 50%');
        await expect.poll(
          () => photo.evaluate(img => {
            const rect = img.getBoundingClientRect();
            const frame = img.parentElement!.getBoundingClientRect();
            return frame.width > 0 ? rect.width / frame.width : Infinity;
          }),
          { message: 'Idle Home printer photo should settle at 58% of its frame width' },
        ).toBeLessThanOrEqual(0.60);
        await expect.poll(
          () => photo.evaluate(img => {
            const rect = img.getBoundingClientRect();
            const frame = img.parentElement!.getBoundingClientRect();
            return frame.height > 0 ? rect.height / frame.height : Infinity;
          }),
          { message: 'Idle Home printer photo should settle at 58% of its frame height' },
        ).toBeLessThanOrEqual(0.60);
        const fit = await photo.evaluate(el => {
          const img = el as HTMLImageElement;
          const box = img.getBoundingClientRect();
          const frame = img.parentElement!.getBoundingClientRect();
          const style = getComputedStyle(img);
          return { fit: style.objectFit, position: style.objectPosition,
            width: box.width, height: box.height, frameWidth: frame.width, frameHeight: frame.height,
            ratio: img.naturalWidth / img.naturalHeight,
            centerX: box.x + box.width / 2 - (frame.x + frame.width / 2),
            centerY: box.y + box.height / 2 - (frame.y + frame.height / 2),
            paintedWidth: Math.min(box.width, box.height * img.naturalWidth / img.naturalHeight),
            paintedHeight: Math.min(box.height, box.width * img.naturalHeight / img.naturalWidth),
          };
        });
        expect(fit.fit).toBe('contain');
        expect(fit.position).toBe('50% 50%');
        expect(fit.width / fit.frameWidth).toBeGreaterThan(0.55);
        expect(fit.width / fit.frameWidth).toBeLessThanOrEqual(0.60);
        expect(fit.height / fit.frameHeight).toBeGreaterThan(0.55);
        expect(fit.height / fit.frameHeight).toBeLessThanOrEqual(0.60);
        expect(Math.abs(fit.centerX)).toBeLessThan(1);
        expect(Math.abs(fit.centerY)).toBeLessThan(1);
        expect(fit.paintedWidth).toBeLessThanOrEqual(fit.frameWidth * 0.60);
        expect(fit.paintedHeight).toBeLessThanOrEqual(fit.frameHeight * 0.60);
        expect(fit.paintedWidth / fit.paintedHeight).toBeCloseTo(shape.width / shape.height, 1);
        expect(fit.ratio).toBeCloseTo(shape.width / shape.height, 1);
        await expectCleanLayout(page);
        expect(mock.controlCalls).toEqual([]);
      });
    }

    test('a finished job shows the printer photo instead of the old file thumbnail', async ({ page }) => {
      const mock = await openWithMock(page, 'settings', { scenario: 'complete' });
      await choosePrinterPhoto(page);
      await page.getByRole('link', { name: 'Home', exact: true }).click();
      await expect(page.getByText('Print complete')).toBeVisible();
      await expect(page.getByRole('heading', { name: FILE_THUMB })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Files' })).toBeVisible();
      const photo = page.getByRole('img', { name: 'Printer photo' });
      await expect(photo).toBeVisible();
      expect(await photo.evaluate(img => img.getBoundingClientRect().width / img.parentElement!.getBoundingClientRect().width)).toBeGreaterThan(0.9);
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
