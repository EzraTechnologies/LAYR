import type { PrinterProfile } from '../config';
import { MoonrakerClient, type ClientEvent, type MoonrakerClientOptions } from '../moonraker/client';
import { mergeStatus, toNumber } from '../moonraker/mapping';
import type { FileMetadata } from '../moonraker/types';
import { assembleState, type AssembleInputs } from './assemble';
import type { PrinterState } from './model';
import type { PrinterSource } from './source';

export interface LiveSourceOptions {
  /** Minimum interval between UI updates. Moonraker can push status several times per second. */
  flushIntervalMs?: number;
  /** Interval for refreshing the clock / ETA when no status updates arrive. */
  clockIntervalMs?: number;
  /** Overrides for the underlying client (tests inject fake sockets here). */
  client?: Partial<Omit<MoonrakerClientOptions, 'baseUrl' | 'apiKey' | 'onEvent'>>;
}

/** Live Moonraker-backed source. Coalesces status diffs and emits at most once per `flushIntervalMs`. */
export class LiveSource implements PrinterSource {
  readonly kind = 'live' as const;
  readonly printerId: string;
  readonly #profile: PrinterProfile;
  readonly #options: Required<Omit<LiveSourceOptions, 'client'>> & Pick<LiveSourceOptions, 'client'>;
  #client: MoonrakerClient | null = null;
  #onState: ((state: PrinterState) => void) | null = null;
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #clockTimer: ReturnType<typeof setInterval> | null = null;
  #lastFlush = 0;
  #inputs: AssembleInputs;
  #metadataFor: string | null = null;

  constructor(profile: PrinterProfile, options: LiveSourceOptions = {}) {
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
      now: this.#now(),
    };
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
        this.#maybeFetchMetadata();
        this.#emitNow();
        return;
      case 'status':
        mergeStatus(inputs.raw, event.diff);
        this.#maybeFetchMetadata();
        this.#schedule();
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
    if (!name || !this.#client) return;
    this.#client
      .query<FileMetadata>('server.files.metadata', { filename: name })
      .then((meta) => {
        if (this.#metadataFor !== name) return;
        this.#inputs.slicerEstimate = toNumber(meta.estimated_time);
        this.#schedule();
      })
      .catch(() => {
        // Metadata is optional (file may have been deleted or never scanned).
      });
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