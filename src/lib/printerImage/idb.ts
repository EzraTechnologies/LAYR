import { coerceStoredImage, PRINTER_IMAGE_DB, PRINTER_IMAGE_STORE, type StoredPrinterImage } from './policy';
import type { PrinterImageRepository } from './library';

function unavailable(): Error {
  const error = new Error('IndexedDB is not available in this browser');
  error.name = 'StorageUnavailable';
  return error;
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(unavailable());
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PRINTER_IMAGE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PRINTER_IMAGE_STORE)) {
        db.createObjectStore(PRINTER_IMAGE_STORE, { keyPath: 'scopeKey' });
      }
    };
    request.onerror = () => reject(request.error ?? unavailable());
    request.onsuccess = () => resolve(request.result);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? unavailable());
  });
}

/**
 * Origin IndexedDB. The photo is not written to localStorage (too small for an
 * image) and not to the app bundle. No Moonraker or host endpoint is involved.
 */
export function createIdbPrinterImageRepository(): PrinterImageRepository {
  return {
    async get(scopeKey) {
      const db = await openDb();
      try {
        const raw = await requestToPromise(db.transaction(PRINTER_IMAGE_STORE, 'readonly').objectStore(PRINTER_IMAGE_STORE).get(scopeKey));
        if (raw === undefined) return null;
        const parsed = coerceStoredImage(raw);
        if (!parsed || parsed.scopeKey !== scopeKey) {
          await requestToPromise(db.transaction(PRINTER_IMAGE_STORE, 'readwrite').objectStore(PRINTER_IMAGE_STORE).delete(scopeKey));
          return null;
        }
        return parsed;
      } finally {
        db.close();
      }
    },
    async put(image: StoredPrinterImage) {
      const db = await openDb();
      try {
        await requestToPromise(db.transaction(PRINTER_IMAGE_STORE, 'readwrite').objectStore(PRINTER_IMAGE_STORE).put(image));
      } finally {
        db.close();
      }
    },
    async delete(scopeKey) {
      const db = await openDb();
      try {
        await requestToPromise(db.transaction(PRINTER_IMAGE_STORE, 'readwrite').objectStore(PRINTER_IMAGE_STORE).delete(scopeKey));
      } finally {
        db.close();
      }
    },
    async list() {
      const db = await openDb();
      try {
        const all = await requestToPromise(db.transaction(PRINTER_IMAGE_STORE, 'readonly').objectStore(PRINTER_IMAGE_STORE).getAll());
        if (!Array.isArray(all)) return [];
        const entries: Array<{ scopeKey: string; savedAt: number }> = [];
        for (const value of all) {
          const parsed = coerceStoredImage(value);
          if (parsed) entries.push({ scopeKey: parsed.scopeKey, savedAt: parsed.savedAt });
        }
        return entries;
      } finally {
        db.close();
      }
    },
  };
}
