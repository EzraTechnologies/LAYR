import { ThumbnailCache, type ThumbnailLease } from './thumbnailCache';
import { errorMessage } from '../moonraker/client';
import type { DirectoryResult, FileMetadata } from '../moonraker/types';
import type { PrinterConnection } from '../printer/source';
import { gcodesFileUrlPath, mapDirectory, mapMetadata, sortFiles, type DirEntry, type FileEntry, type SortKey } from './files';

/** Metadata is fetched for at most this many files per folder when the listing does not include it. */
const MAX_METADATA_FETCHES = 60;
const METADATA_CONCURRENCY = 2;

/** Reactive G-code browser for one printer, backed by `server.files.get_directory` and `server.files.metadata`. */
export class FileBrowser {
  dir = $state('');
  dirs = $state<DirEntry[]>([]);
  files = $state<FileEntry[]>([]);
  sort = $state<SortKey>('modified');
  loading = $state(false);
  error = $state<string | null>(null);
  loaded = $state(false);
  readonly sorted = $derived(sortFiles(this.files, this.sort));

  readonly #connection: PrinterConnection | null;
  #request = 0;
  #reloadTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #thumbnails: ThumbnailCache;
  #visible = false;
  #ready = false;
  #disposed = false;
  readonly #unsubscribe: Array<() => void> = [];

  constructor(connection: PrinterConnection | null) {
    this.#connection = connection;
    this.#thumbnails = new ThumbnailCache(async (path, signal) => {
      if (!connection) throw new Error('Not connected');
      return (await connection.fetchHttp(path, signal)).blob();
    });
    if (!connection) return;
    this.#unsubscribe.push(
      connection.onReady(() => {
        this.#ready = true;
        if ((this.#visible || this.loaded) && !this.loading) void this.load();
      }),
      connection.onTransport(state => {
        if (state === 'connected') return;
        this.#ready = false;
        this.#request += 1;
        this.loading = false;
        if (this.#reloadTimer) clearTimeout(this.#reloadTimer);
        this.#reloadTimer = null;
        this.#thumbnails.clear();
      }),
      connection.onFilelistChanged((change) => {
        if (change.root !== null && change.root !== 'gcodes') return;
        if (!this.#ready || (!this.#visible && !this.loaded)) return;
        // Uploads and slicer metadata scans arrive in bursts; refresh once.
        if (this.#reloadTimer) clearTimeout(this.#reloadTimer);
        this.#reloadTimer = setTimeout(() => {
          this.#reloadTimer = null;
          void this.load();
        }, 600);
      }),
    );
  }

  /** One initial attempt per Files visit. Readiness events own reconnect recovery. */
  enter(): () => void {
    this.#visible = true;
    if (this.#ready && !this.loaded && !this.loading) void this.load();
    return () => { this.#visible = false; };
  }

  dispose(): void {
    this.#disposed = true;
    this.#request += 1;
    this.#unsubscribe.forEach((u) => u());
    if (this.#reloadTimer) clearTimeout(this.#reloadTimer);
    this.#thumbnails.dispose();
  }

  open(dir: string): Promise<void> {
    if (dir !== this.dir) {
      this.loaded = false;
      this.files = [];
      this.dirs = [];
    }
    this.dir = dir;
    return this.load();
  }

  async load(): Promise<void> {
    const connection = this.#connection;
    if (!connection || this.#disposed) return;
    if (this.#reloadTimer) clearTimeout(this.#reloadTimer);
    this.#reloadTimer = null;
    this.#thumbnails.clear();
    const request = ++this.#request;
    const dir = this.dir;
    this.loading = true;
    this.error = null;
    try {
      const result = await connection.call<DirectoryResult>('server.files.get_directory', {
        path: dir ? `gcodes/${dir}` : 'gcodes',
        extended: true,
      });
      if (request !== this.#request) return;
      const mapped = mapDirectory(dir, result);
      this.dirs = mapped.dirs;
      this.files = mapped.files;
      this.loaded = true;
      void this.#fillMetadata(request);
    } catch (error) {
      if (request !== this.#request) return;
      this.error = errorMessage(error);
    } finally {
      if (request === this.#request) this.loading = false;
    }
  }

  /** Older Moonraker versions ignore `extended`; fetch metadata for the files that lack it. */
  async #fillMetadata(request: number): Promise<void> {
    const connection = this.#connection;
    if (!connection) return;
    const queue = this.files.filter((f) => f.meta === null).slice(0, MAX_METADATA_FETCHES).map((f) => f.path);
    const worker = async () => {
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
        if (request !== this.#request) return;
        try {
          const meta = await connection.call<FileMetadata>('server.files.metadata', { filename: path });
          if (request !== this.#request) return;
          const entry = this.files.find((f) => f.path === path);
          if (entry) entry.meta = mapMetadata(path, meta);
        } catch {
          // No metadata (not yet scanned or unsupported slicer): the list shows a placeholder.
        }
      }
    };
    await Promise.all(Array.from({ length: METADATA_CONCURRENCY }, worker));
  }

  /**
   * Image URL for a thumbnail path relative to the `gcodes` root. Trusted clients load it directly; with an API
   * key the image is fetched with the `X-Api-Key` header and shown through a blob URL, because `<img>` cannot
   * send headers.
   */
  thumbnail(path: string, cacheKey: number | null): ThumbnailLease {
    const connection = this.#connection;
    if (!connection) throw new Error('Not connected');
    const urlPath = gcodesFileUrlPath(path, cacheKey);
    if (!connection.hasApiKey) return { url: Promise.resolve(connection.httpUrl(urlPath)), release: () => {} };
    return this.#thumbnails.acquire(urlPath);
  }
}
