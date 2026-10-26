import type { RawStatus, WebSocketLike } from '../src/lib/moonraker/types';

interface RpcMessage {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/** In-memory WebSocket that answers Moonraker JSON-RPC calls via a configurable fake server. */
export class FakeSocket implements WebSocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  readonly sent: RpcMessage[] = [];
  closedByClient = false;

  constructor(
    readonly url: string,
    private readonly server: FakeMoonraker,
  ) {}

  send(data: string): void {
    const msg = JSON.parse(data) as RpcMessage;
    this.sent.push(msg);
    this.server.calls.push(msg.method);
    this.server.handle(this, msg);
  }

  close(): void {
    this.closedByClient = true;
    this.drop();
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  /** Simulates the network or Moonraker going away. */
  drop(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({});
  }

  push(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  notify(method: string, params: unknown[] = []): void {
    this.push({ jsonrpc: '2.0', method, params });
  }
}

export interface FakeMoonrakerOptions {
  klippyState?: string;
  objects?: string[];
  status?: RawStatus;
  hostname?: string;
  /** When true the socket opens automatically when created. */
  autoOpen?: boolean;
  /** Methods that never get a reply (to test timeouts). */
  silent?: string[];
}

export class FakeMoonraker {
  readonly sockets: FakeSocket[] = [];
  readonly calls: string[] = [];
  klippyState: string;
  objects: string[];
  status: RawStatus;
  hostname: string;
  autoOpen: boolean;
  silent: Set<string>;
  /** When false, new sockets fail to connect (closed immediately). */
  online = true;
  subscribeParams: Record<string, unknown> | undefined;
  settings: Record<string, Record<string, unknown>> = {};
  gcodeStore: Array<{ message: string; time: number; type: string }> = [];
  readonly scripts: string[] = [];
  /** Scripts that fail with the given Klipper error message. */
  scriptErrors: Record<string, string> = {};
  /** When true, `printer.gcode.script` never replies (to test unconfirmed outcomes). */
  silentScripts = false;

  constructor(opts: FakeMoonrakerOptions = {}) {
    this.klippyState = opts.klippyState ?? 'ready';
    this.status = opts.status ?? {
      webhooks: { state: 'ready', state_message: 'Printer is ready' },
      print_stats: { filename: '', state: 'standby', print_duration: 0, total_duration: 0, info: {} },
      extruder: { temperature: 25, target: 0, power: 0 },
      heater_bed: { temperature: 24, target: 0, power: 0 },
    };
    this.objects = opts.objects ?? [...Object.keys(this.status), 'configfile'];
    this.hostname = opts.hostname ?? 'fake-host';
    this.autoOpen = opts.autoOpen ?? true;
    this.silent = new Set(opts.silent ?? []);
  }

  createSocket = (url: string): WebSocketLike => {
    const socket = new FakeSocket(url, this);
    this.sockets.push(socket);
    queueMicrotask(() => {
      if (!this.online) socket.drop();
      else if (this.autoOpen) socket.open();
    });
    return socket;
  };

  get last(): FakeSocket {
    const socket = this.sockets.at(-1);
    if (!socket) throw new Error('No socket created');
    return socket;
  }

  handle(socket: FakeSocket, msg: RpcMessage): void {
    if (this.silent.has(msg.method)) return;
    const reply = (result: unknown) => queueMicrotask(() => socket.push({ jsonrpc: '2.0', id: msg.id, result }));
    switch (msg.method) {
      case 'server.connection.identify':
        return reply({ connection_id: 42 });
      case 'server.info':
        return reply({ klippy_connected: this.klippyState !== 'disconnected', klippy_state: this.klippyState });
      case 'printer.info':
        return reply({
          state: this.klippyState,
          state_message: this.klippyState === 'ready' ? 'Printer is ready' : `Klipper ${this.klippyState}`,
          hostname: this.hostname,
        });
      case 'printer.objects.list':
        return reply({ objects: this.objects });
      case 'printer.objects.subscribe': {
        this.subscribeParams = msg.params;
        const requested = Object.keys((msg.params?.objects as Record<string, unknown>) ?? {});
        const status: RawStatus = {};
        for (const name of requested) if (this.status[name]) status[name] = this.status[name];
        return reply({ eventtime: 1, status });
      }
      case 'server.files.metadata':
        return reply({ estimated_time: 3600 });
      case 'printer.objects.query':
        return reply({ eventtime: 1, status: { configfile: { settings: this.settings } } });
      case 'server.gcode_store':
        return reply({ gcode_store: this.gcodeStore });
      case 'printer.gcode.script': {
        const script = String(msg.params?.script);
        this.scripts.push(script);
        if (this.silentScripts) return;
        const error = this.scriptErrors[script];
        if (error) {
          return queueMicrotask(() => socket.push({ jsonrpc: '2.0', id: msg.id, error: { code: 400, message: error } }));
        }
        return reply('ok');
      }
      case 'printer.print.start':
      case 'printer.print.pause':
      case 'printer.print.resume':
      case 'printer.print.cancel':
      case 'printer.emergency_stop':
      case 'printer.restart':
      case 'printer.firmware_restart':
      case 'server.files.delete_file':
        return reply('ok');
      default:
        queueMicrotask(() =>
          socket.push({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } }),
        );
    }
  }
}
