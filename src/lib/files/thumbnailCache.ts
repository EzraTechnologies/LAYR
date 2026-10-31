export interface ThumbnailLease {
  url: Promise<string>;
  release(): void;
}

interface Entry {
  key: string;
  url: Promise<string>;
  objectUrl: string | null;
  bytes: number;
  owners: number;
  retired: boolean;
}

/** Reusable authenticated thumbnails. Active owners may exceed the budget; never evict their URLs. */
export class ThumbnailCache {
  readonly #entries = new Map<string, Entry>();
  readonly #live = new Set<Entry>();
  #disposed = false;

  constructor(
    private readonly download: (key: string) => Promise<Blob>,
    private readonly maxEntries = 32,
    private readonly maxBytes = 8 * 1024 * 1024,
  ) {}

  acquire(key: string): ThumbnailLease {
    if (this.#disposed) throw new Error('Thumbnail cache disposed');
    let entry = this.#entries.get(key);
    if (!entry) {
      entry = { key, url: Promise.resolve(''), objectUrl: null, bytes: 0, owners: 0, retired: false };
      const created = entry;
      this.#entries.set(key, created);
      this.#live.add(created);
      created.url = Promise.resolve().then(() => this.download(key)).then(blob => {
        if (created.retired && created.owners === 0) throw new Error('Thumbnail released');
        created.objectUrl = URL.createObjectURL(blob);
        created.bytes = blob.size;
        this.#trim();
        return created.objectUrl;
      }).catch(error => {
        this.#retire(created);
        throw error;
      });
      // A component can release before it attaches its own rejection handler.
      void created.url.catch(() => {});
    }
    entry.owners += 1;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    this.#trim();
    const owned = entry;
    let released = false;
    return {
      url: owned.url,
      release: () => {
        if (released) return;
        released = true;
        owned.owners -= 1;
        // Do not retain downloads with no consumers, including late results.
        if (owned.retired || !owned.objectUrl) this.#retire(owned);
        this.#trim();
      },
    };
  }

  /** Forget reusable entries on reconnect/refresh; existing owners keep their URLs until release. */
  clear(): void {
    for (const entry of this.#entries.values()) this.#retire(entry);
  }

  dispose(): void {
    this.#disposed = true;
    this.clear();
  }

  #retire(entry: Entry): void {
    entry.retired = true;
    if (this.#entries.get(entry.key) === entry) this.#entries.delete(entry.key);
    if (entry.owners !== 0) return;
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    entry.objectUrl = null;
    entry.bytes = 0;
    this.#live.delete(entry);
  }

  #trim(): void {
    let bytes = [...this.#live].reduce((sum, entry) => sum + entry.bytes, 0);
    for (const entry of this.#entries.values()) {
      if (this.#entries.size <= this.maxEntries && bytes <= this.maxBytes) break;
      if (entry.owners !== 0) continue;
      bytes -= entry.bytes;
      this.#retire(entry);
    }
  }
}
