import type { KlippyState, TransportState } from '../printer/model';
import { Backoff } from './backoff';
import { parseKlippyState } from './mapping';
import { planSubscription } from './objects';
import type {
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  ObjectsListResult,
  PrinterInfo,
  RawStatus,
  ServerInfo,
  SubscribeResult,
  WebSocketLike,
} from './types';
import { WS_OPEN } from './types';

/**
 * JSON-RPC methods LAYR v0.1 is allowed to call. All of them are read-only (or subscription management).
 * Anything that moves, heats or reconfigures the printer — `printer.gcode.script`, `printer.print.*`,
 * `printer.emergency_stop`, `machine.*`, file writes — is deliberately absent and rejected by `query()`.
 */
export const READ_ONLY_METHODS: ReadonlySet<string> = new Set([
  'server.connection.identify',
  'server.info',
  'printer.info',
  'printer.objects.list',
  'printer.objects.query',
  'printer.objects.subscribe',
  'server.files.metadata',
]);

export class MethodNotAllowedError extends Error {
  constructor(method: string) {
    super(`Moonraker method "${method}" is not permitted in LAYR v0.1 (read-only client)`);
    this.name = 'MethodNotAllowedError';
  }
}

export type ClientEvent =
  | { type: 'transport'; state: TransportState; attempt: number; nextRetryAt: number | null; reason: string | null }
  | { type: 'klippy'; state: KlippyState; message: string | null }
  /** Full status after (re)subscribing. Replaces any previously accumulated status. */
  | { type: 'snapshot'; status: RawStatus; missing: string[]; hostname: string | null }
  /** Incremental `notify_status_update` diff. */
  | { type: 'status'; diff: RawStatus };

export interface MoonrakerClientOptions {
  /** Moonraker base URL, e.g. `http://printer.local:7125`. `ws(s)://` URLs are accepted too. */
  baseUrl: string;
  apiKey?: string | null;
  onEvent: (event: ClientEvent) => void;
  clientVersion?: string;
  createSocket?: (url: string) => WebSocketLike;
  fetch?: typeof globalThis.fetch;
  backoff?: Backoff;
  /** Timeout for individual JSON-RPC requests. */
  requestTimeoutMs?: number;
  /** Interval for polling `server.info` while Klipper is not ready. */
  klippyPollMs?: number;
  now?: () => number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function normaliseBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/websocket$/, '');
}

export function toWebSocketUrl(baseUrl: string): string {
  const base = normaliseBaseUrl(baseUrl);
  const url = new URL(base);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`Unsupported Moonraker URL protocol: ${url.protocol}`);
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/websocket`;
  return url.toString();
}

export function toHttpUrl(baseUrl: string, path: string): string {
  const url = new URL(normaliseBaseUrl(baseUrl));
  if (url.protocol === 'ws:') url.protocol = 'http:';
  else if (url.protocol === 'wss:') url.protocol = 'https:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`;
  return url.toString();
}

/**
 * Read-only Moonraker client: connects over WebSocket, identifies, queries and subscribes to printer
 * objects, follows Klippy state changes and reconnects with bounded exponential backoff.
 */
export class MoonrakerClient {
  readonly #opts: Required<Omit<MoonrakerClientOptions, 'apiKey'>> & { apiKey: string | null };
  #socket: WebSocketLike | null = null;
  /** Incremented per connection so events from stale sockets are ignored. */
  #generation = 0;
  #nextId = 1;
  #pending = new Map<number, Pending>();
  #running = false;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #klippyTimer: ReturnType<typeof setTimeout> | null = null;
  #initializing = false;
  #klippy: KlippyState = 'unknown';

  constructor(options: MoonrakerClientOptions) {
    this.#opts = {
      clientVersion: '0.1.0',
      createSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
      fetch: (...args) => globalThis.fetch(...args),
      backoff: new Backoff(),
      requestTimeoutMs: 10_000,
      klippyPollMs: 2_000,
      now: () => Date.now(),
      ...options,
      apiKey: options.apiKey?.trim() || null,
    };
  }

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#opts.backoff.reset();
    void this.#connect();
  }

  stop(): void {
    this.#running = false;
    this.#generation += 1;
    this.#clearTimers();
    this.#teardownSocket('Client stopped');
    this.#emit({ type: 'transport', state: 'idle', attempt: 0, nextRetryAt: null, reason: null });
  }

  /** Calls a read-only JSON-RPC method on the current connection. */
  query<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.#call<T>(method, params);
  }

  #emit(event: ClientEvent): void {
    try {
      this.#opts.onEvent(event);
    } catch (error) {
      console.error('[LAYR] event handler failed', error);
    }
  }

  async #connect(): Promise<void> {
    if (!this.#running) return;
    const generation = ++this.#generation;
    this.#klippy = 'unknown';
    this.#emit({
      type: 'transport',
      state: 'connecting',
      attempt: this.#opts.backoff.attempt,
      nextRetryAt: null,
      reason: null,
    });

    let url: string;
    try {
      url = toWebSocketUrl(this.#opts.baseUrl);
      if (this.#opts.apiKey) {
        const token = await this.#fetchOneshotToken();
        if (generation !== this.#generation || !this.#running) return;
        url += `${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
      }
    } catch (error) {
      this.#handleDisconnect(generation, errorMessage(error));
      return;
    }

    let socket: WebSocketLike;
    try {
      socket = this.#opts.createSocket(url);
    } catch (error) {
      this.#handleDisconnect(generation, errorMessage(error));
      return;
    }
    this.#socket = socket;

    socket.onopen = () => {
      if (generation !== this.#generation) return;
      void this.#onOpen(generation);
    };
    socket.onmessage = (event) => {
      if (generation !== this.#generation) return;
      this.#onMessage(event.data);
    };
    socket.onerror = () => {
      // Browsers always follow `error` with `close`; reconnect is handled there.
    };
    socket.onclose = () => {
      this.#handleDisconnect(generation, 'Connection closed');
    };
  }

  async #fetchOneshotToken(): Promise<string> {
    const response = await this.#opts.fetch(toHttpUrl(this.#opts.baseUrl, '/access/oneshot_token'), {
      headers: { 'X-Api-Key': this.#opts.apiKey ?? '' },
    });
    if (!response.ok) throw new Error(`Authentication failed (HTTP ${response.status})`);
    const body = (await response.json()) as { result?: unknown };
    if (typeof body.result !== 'string') throw new Error('Unexpected oneshot token response');
    return body.result;
  }

  async #onOpen(generation: number): Promise<void> {
    try {
      await this.#call('server.connection.identify', {
        client_name: 'LAYR',
        version: this.#opts.clientVersion,
        type: 'display',
        url: 'https://github.com/EzraTechnologies/LAYR',
      });
      if (generation !== this.#generation) return;
      this.#opts.backoff.reset();
      this.#emit({ type: 'transport', state: 'connected', attempt: 0, nextRetryAt: null, reason: null });
      await this.#refreshKlippy(generation);
    } catch (error) {
      if (generation !== this.#generation) return;
      // Identification or the initial query failed: drop the socket and let backoff retry.
      this.#teardownSocket(errorMessage(error));
      this.#handleDisconnect(generation, errorMessage(error));
    }
  }

  /** Queries `server.info`; initialises printer objects when Klippy is ready, otherwise polls. */
  async #refreshKlippy(generation: number): Promise<void> {
    const info = await this.#call<ServerInfo>('server.info');
    if (generation !== this.#generation) return;
    const state = info.klippy_connected === false ? 'disconnected' : parseKlippyState(info.klippy_state);

    if (state === 'ready') {
      await this.#initPrinter(generation);
      return;
    }

    let message: string | null = null;
    if (state === 'shutdown' || state === 'error' || state === 'startup') {
      message = await this.#printerMessage();
    }
    this.#setKlippy(state, message);
    this.#scheduleKlippyPoll(generation);
  }

  async #printerMessage(): Promise<string | null> {
    try {
      const printer = await this.#call<PrinterInfo>('printer.info');
      return printer.state_message?.trim() || null;
    } catch {
      return null;
    }
  }

  async #initPrinter(generation: number): Promise<void> {
    if (this.#initializing) return;
    this.#initializing = true;
    try {
      const printer = await this.#call<PrinterInfo>('printer.info');
      const list = await this.#call<ObjectsListResult>('printer.objects.list');
      if (generation !== this.#generation) return;
      const plan = planSubscription(Array.isArray(list.objects) ? list.objects : []);
      const result = await this.#call<SubscribeResult>('printer.objects.subscribe', { objects: plan.objects });
      if (generation !== this.#generation) return;
      this.#emit({
        type: 'snapshot',
        status: result.status ?? {},
        missing: plan.missing,
        hostname: printer.hostname?.trim() || null,
      });
      this.#setKlippy(parseKlippyState(printer.state ?? 'ready'), printer.state_message?.trim() || null);
      if (this.#klippy !== 'ready') this.#scheduleKlippyPoll(generation);
    } finally {
      this.#initializing = false;
    }
  }

  #setKlippy(state: KlippyState, message: string | null): void {
    this.#klippy = state;
    this.#emit({ type: 'klippy', state, message: state === 'ready' ? null : message });
  }

  #scheduleKlippyPoll(generation: number): void {
    if (this.#klippyTimer) clearTimeout(this.#klippyTimer);
    this.#klippyTimer = setTimeout(() => {
      this.#klippyTimer = null;
      if (!this.#running || generation !== this.#generation || this.#klippy === 'ready') return;
      this.#refreshKlippy(generation).catch(() => {
        // A failed poll on a live socket is retried; a dead socket triggers a reconnect instead.
        if (generation === this.#generation && this.#socket?.readyState === WS_OPEN) {
          this.#scheduleKlippyPoll(generation);
        }
      });
    }, this.#opts.klippyPollMs);
  }

  #onMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    let message: JsonRpcResponse | JsonRpcNotification;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null) return;

    if ('id' in message && typeof message.id === 'number') {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || `RPC error ${message.error.code}`));
      else pending.resolve(message.result);
      return;
    }

    if ('method' in message) this.#onNotification(message as JsonRpcNotification);
  }

  #onNotification(message: JsonRpcNotification): void {
    const generation = this.#generation;
    switch (message.method) {
      case 'notify_status_update': {
        const diff = message.params?.[0];
        if (typeof diff !== 'object' || diff === null) return;
        const status = diff as RawStatus;
        this.#emit({ type: 'status', diff: status });
        const webhooks = status.webhooks;
        if (webhooks && typeof webhooks.state === 'string') {
          const state = parseKlippyState(webhooks.state);
          const msg = typeof webhooks.state_message === 'string' ? webhooks.state_message : null;
          if (state !== this.#klippy) {
            this.#setKlippy(state, msg);
            if (state !== 'ready') this.#scheduleKlippyPoll(generation);
          }
        }
        return;
      }
      case 'notify_klippy_ready':
        this.#initPrinter(generation).catch(() => this.#scheduleKlippyPoll(generation));
        return;
      case 'notify_klippy_shutdown':
        this.#setKlippy('shutdown', null);
        void this.#printerMessage().then((msg) => {
          if (generation === this.#generation && this.#klippy === 'shutdown' && msg) this.#setKlippy('shutdown', msg);
        });
        this.#scheduleKlippyPoll(generation);
        return;
      case 'notify_klippy_disconnected':
        this.#setKlippy('disconnected', null);
        this.#scheduleKlippyPoll(generation);
        return;
    }
  }

  #call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!READ_ONLY_METHODS.has(method)) return Promise.reject(new MethodNotAllowedError(method));
    const socket = this.#socket;
    if (!socket || socket.readyState !== WS_OPEN) {
      return Promise.reject(new Error('Not connected to Moonraker'));
    }
    const id = this.#nextId++;
    const request: JsonRpcRequest = { jsonrpc: '2.0', method, id };
    if (params) request.params = params;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Moonraker request "${method}" timed out`));
      }, this.#opts.requestTimeoutMs);
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        socket.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  #handleDisconnect(generation: number, reason: string): void {
    if (generation !== this.#generation) return;
    // Invalidate this connection so late callbacks from it are ignored.
    this.#generation += 1;
    this.#rejectPending(reason);
    this.#socket = null;
    if (this.#klippyTimer) {
      clearTimeout(this.#klippyTimer);
      this.#klippyTimer = null;
    }
    this.#klippy = 'unknown';
    if (!this.#running) return;

    const delay = this.#opts.backoff.next();
    const nextRetryAt = this.#opts.now() + delay;
    this.#emit({
      type: 'transport',
      state: 'waiting',
      attempt: this.#opts.backoff.attempt,
      nextRetryAt,
      reason,
    });
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.#connect();
    }, delay);
  }

  #teardownSocket(reason: string): void {
    const socket = this.#socket;
    this.#socket = null;
    this.#rejectPending(reason);
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // Ignore: the socket may already be closed.
    }
  }

  #rejectPending(reason: string): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.#pending.clear();
  }

  #clearTimers(): void {
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    if (this.#klippyTimer) clearTimeout(this.#klippyTimer);
    this.#reconnectTimer = null;
    this.#klippyTimer = null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
