import { expect, type Page } from '@playwright/test';
import { integrationScopeKey } from '../src/lib/integrations/preferences';
import { PRINTER_IMAGE_DB, PRINTER_IMAGE_STORE } from '../src/lib/printerImage/policy';
import { MOONRAKER } from './mockMoonraker';
import { encodePng } from './png';

export const PRINTER_SCOPE = integrationScopeKey('default', MOONRAKER);

/** A generated photo. It is not a picture of a real printer. */
export function samplePhoto(): { name: string; mimeType: string; buffer: Buffer } {
  return {
    name: 'printer.png',
    mimeType: 'image/png',
    buffer: encodePng(240, 160, (x, y) => {
      if (x < 18 || y < 18 || x > 221 || y > 141) return [17, 24, 34, 255];
      if (y > 96 && y < 116) return [62, 224, 240, 255];
      if (x > 104 && x < 136 && y > 46 && y < 78) return [139, 108, 255, 255];
      return [28, 36, 52, 255];
    }),
  };
}

export async function choosePrinterPhoto(page: Page): Promise<void> {
  await page.locator('#printer-image-file').setInputFiles(samplePhoto());
  await expect(page.getByRole('img', { name: 'Printer photo' })).toBeVisible();
}

export async function storedPrinterPhoto(
  page: Page,
  scopeKey = PRINTER_SCOPE,
): Promise<{ size: number; mime: string; width: number; height: number } | null> {
  return page.evaluate(
    async ({ dbName, storeName, key }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      try {
        const record = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
          const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
        });
        if (!record || !(record.blob instanceof Blob)) return null;
        return {
          size: record.blob.size,
          mime: typeof record.mime === 'string' ? record.mime : '',
          width: typeof record.width === 'number' ? record.width : 0,
          height: typeof record.height === 'number' ? record.height : 0,
        };
      } finally {
        db.close();
      }
    },
    { dbName: PRINTER_IMAGE_DB, storeName: PRINTER_IMAGE_STORE, key: scopeKey },
  );
}
