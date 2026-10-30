import {
  hasJpegMagic,
  isScopeKey,
  isUsableImage,
  keysToForget,
  LIMITS,
  type ImageProblem,
  type StoredPrinterImage,
} from './policy';

export interface PrinterImageRepository {
  get(scopeKey: string): Promise<StoredPrinterImage | null>;
  put(image: StoredPrinterImage): Promise<void>;
  delete(scopeKey: string): Promise<void>;
  list(): Promise<Array<{ scopeKey: string; savedAt: number }>>;
}

export type SaveOutcome = { ok: true } | { ok: false; code: ImageProblem };
export type ReadOutcome =
  | { status: 'empty' }
  | { status: 'ok'; image: StoredPrinterImage }
  | { status: 'invalid' }
  | { status: 'failed' };

export class MemoryPrinterImageRepository implements PrinterImageRepository {
  readonly items = new Map<string, StoredPrinterImage>();
  failPut: 'quota' | 'storage' | null = null;
  failGet = false;

  async get(scopeKey: string): Promise<StoredPrinterImage | null> {
    if (this.failGet) throw new Error('storage unavailable');
    return this.items.get(scopeKey) ?? null;
  }

  async put(image: StoredPrinterImage): Promise<void> {
    if (this.failPut === 'quota') {
      const error = new Error('quota');
      error.name = 'QuotaExceededError';
      throw error;
    }
    if (this.failPut === 'storage') throw new Error('blocked');
    this.items.set(image.scopeKey, image);
  }

  async delete(scopeKey: string): Promise<void> {
    this.items.delete(scopeKey);
  }

  async list(): Promise<Array<{ scopeKey: string; savedAt: number }>> {
    return [...this.items.values()].map((image) => ({ scopeKey: image.scopeKey, savedAt: image.savedAt }));
  }
}

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('name' in error)) return false;
  const name = String(error.name);
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

/**
 * Per-printer photo book. The repository is IndexedDB in the app and an in-memory
 * map in tests. Reads never return another printer's blob.
 */
export class ImageLibrary {
  constructor(private readonly repo: PrinterImageRepository) {}

  async read(scopeKey: string): Promise<ReadOutcome> {
    if (!isScopeKey(scopeKey)) return { status: 'failed' };
    let image: StoredPrinterImage | null;
    try {
      image = await this.repo.get(scopeKey);
    } catch {
      return { status: 'failed' };
    }
    if (!image) return { status: 'empty' };
    if (image.scopeKey !== scopeKey) return { status: 'failed' };
    const usable = isUsableImage(image) && (await hasJpegMagic(image.blob));
    if (!usable) {
      try {
        await this.repo.delete(scopeKey);
      } catch {
        // Still hide the bad record. A later save can retry the delete.
      }
      return { status: 'invalid' };
    }
    return { status: 'ok', image };
  }

  async save(image: StoredPrinterImage): Promise<SaveOutcome> {
    if (!isUsableImage(image) || !(await hasJpegMagic(image.blob))) return { ok: false, code: 'unreadable' };
    let existing: Array<{ scopeKey: string; savedAt: number }>;
    try {
      existing = await this.repo.list();
    } catch {
      return { ok: false, code: 'storage' };
    }
    const forget = keysToForget(existing, image.scopeKey, LIMITS.maxPrinters);
    try {
      await this.repo.put(image);
    } catch (error) {
      return { ok: false, code: isQuotaError(error) ? 'quota' : 'storage' };
    }
    for (const key of forget) {
      try {
        await this.repo.delete(key);
      } catch {
        // The new photo is stored. A later save drops the overflow.
      }
    }
    return { ok: true };
  }

  async remove(scopeKey: string): Promise<SaveOutcome> {
    if (!isScopeKey(scopeKey)) return { ok: false, code: 'remove' };
    try {
      await this.repo.delete(scopeKey);
      return { ok: true };
    } catch {
      return { ok: false, code: 'remove' };
    }
  }
}
