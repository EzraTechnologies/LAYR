import { compressPrinterPhoto } from './compress';
import { createIdbPrinterImageRepository } from './idb';
import { ImageLibrary } from './library';
import { classifyFile, isScopeKey, printerImageErrorText, printerImageScopeKey, PrinterImageError } from './policy';

/**
 * The photo for the active printer profile.
 * `url` is a blob URL for that profile only. Rebinding clears it before the next
 * read so a previous printer cannot remain on screen.
 */
export class PrinterImageStore {
  scopeKey = $state('');
  url = $state<string | null>(null);
  bytes = $state<number | null>(null);
  phase = $state<'idle' | 'loading' | 'saving'>('idle');
  error = $state<string | null>(null);

  #generation = 0;
  #objectUrl: string | null = null;
  #boundKey: string | null = null;
  readonly #library: ImageLibrary;

  constructor(library: ImageLibrary = new ImageLibrary(createIdbPrinterImageRepository())) {
    this.#library = library;
  }

  bind(printerId: string, moonrakerUrl: string | null): void {
    const key = printerImageScopeKey(printerId, moonrakerUrl);
    if (key === this.#boundKey) return;
    this.#boundKey = key;
    this.scopeKey = key;
    const generation = ++this.#generation;
    this.#clearUrl();
    this.error = null;
    this.phase = 'loading';
    void this.#library
      .read(key)
      .then((outcome) => {
        if (generation !== this.#generation) return;
        if (outcome.status === 'ok') this.#setUrl(outcome.image.blob);
        else this.#clearUrl();
        this.error =
          outcome.status === 'invalid' ? printerImageErrorText('invalid') : outcome.status === 'failed' ? printerImageErrorText('read') : null;
        this.phase = 'idle';
      })
      .catch(() => {
        if (generation !== this.#generation) return;
        this.#clearUrl();
        this.error = printerImageErrorText('read');
        this.phase = 'idle';
      });
  }

  async importFile(file: File): Promise<void> {
    if (this.phase === 'saving') return;
    const problem = classifyFile(file);
    if (problem) {
      this.error = printerImageErrorText(problem);
      return;
    }
    if (!isScopeKey(this.scopeKey)) {
      this.error = printerImageErrorText('storage');
      return;
    }
    const generation = ++this.#generation;
    const scopeKey = this.scopeKey;
    this.phase = 'saving';
    this.error = null;
    try {
      const encoded = await compressPrinterPhoto(file);
      if (generation !== this.#generation) return;
      const saved = await this.#library.save({
        scopeKey,
        blob: encoded.blob,
        mime: 'image/jpeg',
        width: encoded.width,
        height: encoded.height,
        savedAt: Date.now(),
      });
      if (generation !== this.#generation) return;
      if (!saved.ok) {
        this.error = printerImageErrorText(saved.code);
        this.phase = 'idle';
        return;
      }
      this.#setUrl(encoded.blob);
      this.phase = 'idle';
    } catch (error) {
      if (generation !== this.#generation) return;
      const code = error instanceof PrinterImageError ? error.code : 'unreadable';
      this.error = printerImageErrorText(code);
      this.phase = 'idle';
    }
  }

  async remove(): Promise<void> {
    if (this.phase === 'saving' || !isScopeKey(this.scopeKey)) return;
    const generation = ++this.#generation;
    const scopeKey = this.scopeKey;
    this.phase = 'saving';
    this.error = null;
    const outcome = await this.#library.remove(scopeKey);
    if (generation !== this.#generation) return;
    if (!outcome.ok) {
      this.error = printerImageErrorText(outcome.code);
      this.phase = 'idle';
      return;
    }
    this.#clearUrl();
    this.phase = 'idle';
  }

  #setUrl(blob: Blob): void {
    const next = URL.createObjectURL(blob);
    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
    this.#objectUrl = next;
    this.url = next;
    this.bytes = blob.size;
  }

  #clearUrl(): void {
    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
    this.#objectUrl = null;
    this.url = null;
    this.bytes = null;
  }
}

export const printerImages = new PrinterImageStore();
