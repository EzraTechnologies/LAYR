import type { PrinterProfile } from '../config';
import { mapThumbnails, pickThumbnail } from '../files/files';
import { MoonrakerClient, type CallOptions, type ClientEvent, type MoonrakerClientOptions } from '../moonraker/client';
import { mergeStatus, toNumber } from '../moonraker/mapping';
import type { ConfigSettings, FileMetadata, ServerInfo } from '../moonraker/types';
import type { SpoolmanNotice } from '../spoolman/api';
import { assembleState, type AssembleInputs } from './assemble';
import type { PrinterState, TransportState } from './model';
import type { PrinterConnection, PrinterSource } from './source';

export interface LiveSourceOptions {
  /** Minimum interval between UI updates. Moonraker can push status several times per second. */
  flushIntervalMs?: number;
  /** Interval for refreshing the clock / ETA when no status updates arrive. */
  clockIntervalMs?: number;
  /** Overrides for the underlying client (tests inject fake sockets here). */
  client?: Partial<Omit<MoonrakerClientOptions, 'baseUrl' | 'apiKey' | 'onEvent'>>;
}

type FileChange = { action: string; path: string | null; root: string | null };

class Listeners<T> {
  readonly #set = new Set<(value: T) => void>();
  add(listener: (value: T) => void): () => void {
    this.#set.add(listener);
    return () => this.#set.delete(listener);
  }
  emit(value: T): void {
    for (const listener of this.#set) {
      try {
        listener(value);
      } catch (error) {
        console.error('[LAYR] listener failed', error);
      }
    }
  }
}

/** Live Moonraker-backed source. Coalesces status diffs and emits at most once per `flushIntervalMs`. */
export class LiveSource implements PrinterSource, PrinterConnection {
  readonly kind = 'live' as const;
  readonly printerId: string;
  readonly #profile: PrinterProfile & { moonrakerUrl: string };
  readonly #options: Required<Omit<LiveSourceOptions, 'client'>> & Pick<LiveSourceOptions, 'client'>;
  #client: MoonrakerClient | null = null;
  #onState: ((state: PrinterState) => void) | null = null;
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #clockTimer: ReturnType<typeof setInterval> | null = null;
  #lastFlush = 0;
  #inputs: AssembleInputs;
  #metadataFor: string | null = null;
  readonly #ready = new Listeners<void>();
  readonly #gcode = new Listeners<string>();
  readonly #files = new Listeners<FileChange>();
  readonly #transport = new Listeners<TransportState>();
  readonly #serverInfo = new Listeners<ServerInfo>();
  readonly #spoolman = new Listeners<SpoolmanNotice>();

  constructor(profile: PrinterProfile & { moonrakerUrl: string }, options: LiveSourceOptions = {}) {
    this.printerId = profile.id;
    this.#profile = profile;
    this.#options = { flushIntervalMs: 250, clockIntervalMs: 15_000, ...options };
    this.#inputs = {
      printerId: profile.id,
      configuredName: profile.name,
      hostname: null,
      transport: 'idle',
      klippy: 'unknown',
      klippyMessage: null,
      reconnectAttempt: 0,
      nextRetryAt: null,
      transportReason: null,
      raw: {},
      slicerEstimate: null,
      missingObjects: [],
      objects: [],
      settings: {},
      thumbnailPath: null,
      gcodeCommands: null,
      now: this.#now(),
    };
  }

  get connection(): PrinterConnection {
    return this;
  }

  get hasApiKey(): boolean {
    return !!this.#profile.apiKey;
  }

  get connected(): boolean {
    return this.#client?.connected ?? false;
  }

  start(onState: (state: PrinterState) => void): void {
    if (this.#client) return;
    this.#onState = onState;
    this.#client = new MoonrakerClient({
      ...this.#options.client,
      baseUrl: this.#profile.moonrakerUrl,
      apiKey: this.#profile.apiKey,
      onEvent: (event) => this.#handle(event),
    });
    this.#clockTimer = setInterval(() => this.#schedule(), this.#options.clockIntervalMs);
    this.#emitNow();
    this.#client.start();
  }

  stop(): void {
    this.#client?.stop();
    this.#client = null;
    if (this.#flushTimer) clearTimeout(this.#flushTimer);
    if (this.#clockTimer) clearInterval(this.#clockTimer);
    this.#flushTimer = null;
    this.#clockTimer = null;
    this.#onState = null;
  }

  call<T = unknown>(method: string, params?: Record<string, unknown>, options?: CallOptions): Promise<T> {
    if (!this.#client) return Promise.reject(new Error('Not connected to Moonraker'));
    return this.#client.call<T>(method, params, options);
  }

  httpUrl(path: string): string {
    if (!this.#client) throw new Error('Not connected to Moonraker');
    return this.#client.httpUrl(path);
  }

  fetchHttp(path: string): Promise<Response> {
    if (!this.#client) return Promise.reject(new Error('Not connected to Moonraker'));
    return this.#client.fetchHttp(path);
  }

  reconnect(): void {
    this.#client?.reconnect();
  }

  onReady(listener: () => void): () => void {
    return this.#ready.add(listener);
  }

  onGcodeResponse(listener: (message: string) => void): () => void {
    return this.#gcode.add(listener);
  }

  onFilelistChanged(listener: (change: FileChange) => void): () => void {
    return this.#files.add(listener);
  }

  onTransport(listener: (state: TransportState) => void): () => void {
    return this.#transport.add(listener);
  }

  onServerInfo(listener: (info: ServerInfo) => void): () => void {
    return this.#serverInfo.add(listener);
  }

  onSpoolmanNotice(listener: (notice: SpoolmanNotice) => void): () => void {
    return this.#spoolman.add(listener);
  }

  #now(): number {
    return this.#options.client?.now?.() ?? Date.now();
  }

  #handle(event: ClientEvent): void {
    const inputs = this.#inputs;
    switch (event.type) {
      case 'transport':
        inputs.transport = event.state;
        inputs.reconnectAttempt = event.attempt;
        inputs.nextRetryAt = event.nextRetryAt;
        inputs.transportReason = event.reason;
        if (event.state !== 'connected') inputs.klippy = 'unknown';
        // Connection changes are shown immediately; they are rare.
        this.#emitNow();
        this.#transport.emit(event.state);
        return;
      case 'klippy':
        inputs.klippy = event.state;
        inputs.klippyMessage = event.message;
        this.#emitNow();
        return;
      case 'snapshot':
        inputs.raw = mergeStatus({}, event.status);
        inputs.missingObjects = event.missing;
        inputs.hostname = event.hostname;
        inputs.objects = event.objects;
        inputs.settings = event.settings;
        inputs.gcodeCommands = event.gcodeCommands;
        this.#metadataFor = null;
        this.#maybeFetchMetadata();
        this.#emitNow();
        this.#ready.emit();
        return;
      case 'status':
        mergeStatus(inputs.raw, event.diff);
        this.#mergeSettings(event.diff.configfile?.settings);
        this.#maybeFetchMetadata();
        this.#schedule();
        return;
      case 'host':
        inputs.hostname = event.hostname;
        return;
      case 'gcode_response':
        this.#gcode.emit(event.message);
        return;
      case 'filelist_changed':
        this.#files.emit({ action: event.action, path: event.path, root: event.root });
        return;
      case 'server':
        this.#serverInfo.emit(event.info);
        return;
      case 'spoolman':
        this.#spoolman.emit(event.notice);
        return;
    }
  }

  /** Fetches the slicer time estimate once per file; used for ETA early in a print. */
  #maybeFetchMetadata(): void {
    const filename = this.#inputs.raw.print_stats?.filename;
    const name = typeof filename === 'string' && filename !== '' ? filename : null;
    if (name === this.#metadataFor) return;
    this.#metadataFor = name;
    this.#inputs.slicerEstimate = null;
    // Drop the previous file's thumbnail immediately so a slow metadata reply cannot leave it on screen.
    this.#inputs.thumbnailPath = null;
    if (!name || !this.#client) return;
    this.#client
      .call<FileMetadata>('server.files.metadata', { filename: name })
      .then((meta) => {
        if (this.#metadataFor !== name) return;
        this.#inputs.slicerEstimate = toNumber(meta.estimated_time);
        this.#inputs.thumbnailPath = pickThumbnail(mapThumbnails(name, meta.thumbnails), 96)?.path ?? null;
        this.#schedule();
      })
      .catch(() => {
        // Metadata is optional (file may have been deleted or never scanned).
      });
  }

  /** Section-level merge. A partial `configfile.settings` diff must not wipe unrelated sections. */
  #mergeSettings(settings: unknown): void {
    if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return;
    this.#inputs.settings = { ...this.#inputs.settings, ...(settings as ConfigSettings) };
  }

  #schedule(): void {
    if (this.#flushTimer) return;
    const wait = Math.max(0, this.#lastFlush + this.#options.flushIntervalMs - this.#now());
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      this.#emitNow();
    }, wait);
  }

  #emitNow(): void {
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
    if (!this.#onState) return;
    this.#lastFlush = this.#now();
    this.#inputs.now = this.#lastFlush;
    this.#onState(assembleState(this.#inputs));
  }
}